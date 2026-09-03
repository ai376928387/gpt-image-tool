import { useEffect, useMemo, useRef, useState } from "react";

import "./index.css";
import {
  filterPromptCatalog,
  promptCatalogCategories,
  promptCatalogEntries,
  promptCatalogEntryCount,
  promptCatalogSourceRepo,
  type PromptCatalogEntry,
} from "./promptCatalog";

function getDownloadName(prompt: string, outputFormat: ImageOutputFormat) {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${slug || "generated-image"}.${outputFormat}`;
}

type GenerateFailure = {
  error?: string;
  technicalDetails?: string;
};

type GenerateSuccess = {
  imageDataUrl?: string;
};

type ImageQuality = "auto" | "low" | "medium" | "high";
type ImageOutputFormat = "png" | "jpeg" | "webp";

const GATEWAY_BASE_URL = `http://127.0.0.1:${import.meta.env.VITE_GATEWAY_PORT || "3001"}`;

function getCatalogEntryMeta(entry: PromptCatalogEntry) {
  return [entry.category, entry.sizeLabel, entry.resolution].filter(Boolean).join(" · ");
}

function getCatalogSourceLabel(entry: PromptCatalogEntry) {
  if (entry.sourceType === "curated") {
    return "Curated";
  }

  if (entry.sourceName) {
    return `Source: ${entry.sourceName}`;
  }

  return "External";
}

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [quality, setQuality] = useState<ImageQuality>("high");
  const [outputFormat, setOutputFormat] = useState<ImageOutputFormat>("png");
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [operatorError, setOperatorError] = useState<string | null>(null);
  const [technicalDetails, setTechnicalDetails] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(promptCatalogEntries[0]?.id ?? null);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);

  const downloadName = useMemo(() => getDownloadName(prompt, outputFormat), [prompt, outputFormat]);
  const filteredCatalogEntries = useMemo(
    () => filterPromptCatalog(promptCatalogEntries, catalogQuery, selectedCategory),
    [catalogQuery, selectedCategory],
  );
  const selectedCatalogEntry = useMemo(() => {
    if (!selectedPromptId) {
      return filteredCatalogEntries[0] ?? promptCatalogEntries[0] ?? null;
    }

    return (
      filteredCatalogEntries.find((entry) => entry.id === selectedPromptId) ??
      promptCatalogEntries.find((entry) => entry.id === selectedPromptId) ??
      filteredCatalogEntries[0] ??
      promptCatalogEntries[0] ??
      null
    );
  }, [filteredCatalogEntries, selectedPromptId]);
  const visibleCatalogEntries = useMemo(() => filteredCatalogEntries.slice(0, 24), [filteredCatalogEntries]);

  useEffect(() => {
    return () => {
      if (referencePreviewUrl) {
        URL.revokeObjectURL(referencePreviewUrl);
      }
    };
  }, [referencePreviewUrl]);

  useEffect(() => {
    if (!selectedCatalogEntry && visibleCatalogEntries[0]) {
      setSelectedPromptId(visibleCatalogEntries[0].id);
      return;
    }

    if (selectedCatalogEntry && !visibleCatalogEntries.some((entry) => entry.id === selectedCatalogEntry.id) && visibleCatalogEntries[0]) {
      setSelectedPromptId(visibleCatalogEntries[0].id);
    }
  }, [selectedCatalogEntry, visibleCatalogEntries]);

  function handleReferenceImageChange(file: File | null) {
    setReferencePreviewUrl((currentPreviewUrl) => {
      if (currentPreviewUrl) {
        URL.revokeObjectURL(currentPreviewUrl);
      }

      return file ? URL.createObjectURL(file) : null;
    });

    setReferenceImage(file);
  }

  function handleReferenceImageRemove() {
    handleReferenceImageChange(null);

    if (referenceInputRef.current) {
      referenceInputRef.current.value = "";
    }
  }

  function handleUseCatalogPrompt(entry: PromptCatalogEntry) {
    setPrompt(entry.promptText);
    setSelectedPromptId(entry.id);
  }

  function handleRemixCatalogPrompt(entry: PromptCatalogEntry) {
    setPrompt((currentPrompt) => {
      const trimmedPrompt = currentPrompt.trim();

      if (!trimmedPrompt) {
        return entry.promptText;
      }

      return `${trimmedPrompt}\n\nAdditional inspiration:\n${entry.promptText}`;
    });
    setSelectedPromptId(entry.id);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      setOperatorError("Prompt is required.");
      setTechnicalDetails(null);
      return;
    }

    setIsGenerating(true);
    setImageDataUrl(null);
    setOperatorError(null);
    setTechnicalDetails(null);
    setShowTechnicalDetails(false);

    try {
      const formData = new FormData();
      formData.set("prompt", trimmedPrompt);
      formData.set("size", size);
      formData.set("quality", quality);
      formData.set("output_format", outputFormat);

      if (referenceImage) {
        formData.set("referenceImage", referenceImage);
      }

      const response = await fetch(`${GATEWAY_BASE_URL}/generate`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const failure = (await response.json()) as GenerateFailure;
        throw Object.assign(new Error(failure.error || "Image generation failed."), {
          technicalDetails: failure.technicalDetails,
        });
      }

      const payload = (await response.json()) as GenerateSuccess;

      if (!payload.imageDataUrl) {
        throw new Error("Image generation failed.");
      }

      setImageDataUrl(payload.imageDataUrl);
    } catch (error) {
      const technicalError = error as Error & { technicalDetails?: string };
      setImageDataUrl(null);
      setOperatorError(technicalError.message || "Image generation failed.");
      setTechnicalDetails(technicalError.technicalDetails || null);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="page-header">
        <p className="eyebrow">Internal image tool</p>
        <h1>Generate images from a prompt.</h1>
        <p className="lede">Use text only, or upload a reference image to guide the result. Provider configuration stays in the local gateway.</p>
      </header>

      <section className="three-column-layout">
        <section className="panel panel-form">
          <form className="form-stack" onSubmit={handleSubmit}>
            <label className="field">
              <span>Prompt</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe the image you want to generate..."
                rows={7}
              />
            </label>

            <section className="catalog-panel" aria-label="Prompt catalog">
              <div className="catalog-panel-header">
                <div>
                  <p className="eyebrow">Prompt library</p>
                  <h2>Search {promptCatalogEntryCount} prompts</h2>
                  <p className="catalog-copy">Browse the imported `gpt_image_2_skill` gallery, then use a prompt directly or remix it into your own version.</p>
                </div>
                <a className="catalog-source-link" href={promptCatalogSourceRepo} target="_blank" rel="noreferrer">
                  View source repo
                </a>
              </div>

              <div className="catalog-toolbar">
                <label className="field catalog-field">
                  <span>Search library</span>
                  <input
                    type="text"
                    value={catalogQuery}
                    onChange={(event) => setCatalogQuery(event.target.value)}
                    placeholder="Search by title, category, or prompt text"
                  />
                </label>

                <label className="field catalog-field">
                  <span>Category</span>
                  <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
                    <option value="all">All categories</option>
                    {promptCatalogCategories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <p className="catalog-results-count">
                Showing {visibleCatalogEntries.length} of {filteredCatalogEntries.length} matching prompts
              </p>

              <div className="catalog-results" role="list">
                {visibleCatalogEntries.length ? (
                  visibleCatalogEntries.map((entry) => {
                    const isSelected = selectedCatalogEntry?.id === entry.id;

                    return (
                      <article
                        key={entry.id}
                        className={`catalog-card${isSelected ? " catalog-card-selected" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedPromptId(entry.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedPromptId(entry.id);
                          }
                        }}
                      >
                        <div className="catalog-card-top">
                          <div>
                            <p className="catalog-card-number">No. {entry.number}</p>
                            <h3>{entry.title}</h3>
                          </div>
                          <span className="catalog-card-source">{getCatalogSourceLabel(entry)}</span>
                        </div>
                        <p className="catalog-card-meta">{getCatalogEntryMeta(entry)}</p>
                        <p className="catalog-card-preview">{entry.promptText.slice(0, 180)}...</p>
                        <div className="catalog-card-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleUseCatalogPrompt(entry);
                            }}
                          >
                            Use prompt
                          </button>
                          <button
                            type="button"
                            className="sample-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleRemixCatalogPrompt(entry);
                            }}
                          >
                            Remix
                          </button>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div className="catalog-empty-state">
                    <p className="catalog-empty-title">No prompts match your search.</p>
                    <p>Try a broader keyword or switch back to all categories.</p>
                  </div>
                )}
              </div>

              {selectedCatalogEntry ? (
                <div className="catalog-selection-panel">
                  <div className="catalog-selection-header">
                    <div>
                      <p className="catalog-selection-kicker">Selected prompt</p>
                      <h3>{selectedCatalogEntry.title}</h3>
                    </div>
                    <p className="catalog-card-meta">{getCatalogEntryMeta(selectedCatalogEntry)}</p>
                  </div>
                  <pre className="catalog-selection-text">{selectedCatalogEntry.promptText}</pre>
                </div>
              ) : null}
            </section>

            <label className="field">
              <span>Upload reference image</span>
              <input
                ref={referenceInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => handleReferenceImageChange(event.target.files?.[0] || null)}
              />
            </label>

            <div className="field-group">
              <label className="field">
                <span>Size</span>
                <input
                  type="text"
                  value={size}
                  onChange={(event) => setSize(event.target.value)}
                  placeholder="1024x1024"
                />
              </label>

              <label className="field">
                <span>Quality</span>
                <select value={quality} onChange={(event) => setQuality(event.target.value as ImageQuality)}>
                  <option value="auto">auto</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>

              <label className="field">
                <span>Output format</span>
                <select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as ImageOutputFormat)}>
                  <option value="png">png</option>
                  <option value="jpeg">jpeg</option>
                  <option value="webp">webp</option>
                </select>
              </label>
            </div>

            <div className="action-row">
              <button type="submit" className="primary-button" disabled={isGenerating}>
                {isGenerating ? "Generating..." : referenceImage ? "Generate from prompt + image" : "Generate image"}
              </button>
            </div>
          </form>

          {operatorError ? (
            <div className="error-panel">
              <p className="error-title">{operatorError}</p>
              {technicalDetails ? (
                <div className="technical-details">
                  <button type="button" className="details-toggle" onClick={() => setShowTechnicalDetails((value) => !value)}>
                    {showTechnicalDetails ? "Hide technical details" : "Show technical details"}
                  </button>
                  {showTechnicalDetails ? <pre>{technicalDetails}</pre> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="panel panel-reference">
          <div className="panel-heading">
            <p className="eyebrow">Reference</p>
            <h2>Uploaded reference image</h2>
          </div>

          {referencePreviewUrl ? (
            <div className="reference-preview reference-preview-standalone">
              <div className="reference-preview-header">
                <p>Reference image</p>
                <button type="button" className="secondary-button" onClick={handleReferenceImageRemove}>
                  Remove image
                </button>
              </div>
              <img src={referencePreviewUrl} alt="Reference preview" />
            </div>
          ) : (
            <div className="empty-state empty-state-panel">
              <p className="eyebrow">Reference</p>
              <h2>No reference image selected.</h2>
              <p>Upload a PNG, JPEG, or WebP image from the input panel to guide the generation.</p>
            </div>
          )}
        </section>

        <section className="panel panel-preview">
          <div className="panel-heading panel-heading-light">
            <div>
              <p className="eyebrow">Preview</p>
              <h2>Generated image</h2>
            </div>

            {imageDataUrl ? (
              <a href={imageDataUrl} download={downloadName} className="download-button">
                Download image
              </a>
            ) : (
              <span className="download-placeholder">No image yet</span>
            )}
          </div>

          <div className="preview-stage">
            {imageDataUrl ? (
              <img src={imageDataUrl} alt={prompt || "Generated image preview"} className="preview-image" />
            ) : (
              <div className="empty-state empty-state-panel">
                <p className="eyebrow">Preview</p>
                <h2>Your generation result will appear here.</h2>
                <p>Enter a prompt, optionally upload one reference image, then generate the result from this page.</p>
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
