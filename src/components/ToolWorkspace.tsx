import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  FileText,
  Trash2,
  Download,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Loader2,
  RefreshCw,
  Eye,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  X,
} from 'lucide-react';
import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib';
import { PdfTool, PdfMetadata } from '../types';

interface ToolWorkspaceProps {
  tool: PdfTool;
  onBack: () => void;
}

export const ToolWorkspace: React.FC<ToolWorkspaceProps> = ({ tool, onBack }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Results state
  const [serverPreviewUrl, setServerPreviewUrl] = useState<string | null>(null);
  const [serverDownloadUrl, setServerDownloadUrl] = useState<string | null>(null);
  const [processedBytes, setProcessedBytes] = useState<Uint8Array | null>(null);
  const [processedPageCount, setProcessedPageCount] = useState<number | null>(null);
  const [processedFileSize, setProcessedFileSize] = useState<number | null>(null);
  const [resultFileName, setResultFileName] = useState<string>('output.pdf');
  const [pdfInfo, setPdfInfo] = useState<PdfMetadata | null>(null);
  const [showPageInspector, setShowPageInspector] = useState<boolean>(false);
  const [pageDetails, setPageDetails] = useState<Array<{ pageNumber: number; width: number; height: number; rotation: number }>>([]);

  // Tool specific options
  const [splitPages, setSplitPages] = useState('1');
  const [rotateAngle, setRotateAngle] = useState('90');
  const [pageNumberPosition, setPageNumberPosition] = useState('bottom-center');
  const [startingNumber, setStartingNumber] = useState('1');
  const [numberPrefix, setNumberPrefix] = useState('Page ');
  const [watermarkText, setWatermarkText] = useState('CONFIDENTIAL');
  const [watermarkOpacity, setWatermarkOpacity] = useState('0.25');
  const [watermarkFontSize, setWatermarkFontSize] = useState('48');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetResults = () => {
    setErrorMessage(null);
    setServerPreviewUrl(null);
    setServerDownloadUrl(null);
    setProcessedBytes(null);
    setProcessedPageCount(null);
    setProcessedFileSize(null);
    setPdfInfo(null);
    setShowPageInspector(false);
    setPageDetails([]);
  };

  // Reset workspace when user switches or re-selects a tool
  useEffect(() => {
    setFiles([]);
    resetResults();
  }, [tool.id]);

  const loadPageDetails = async (bytes: Uint8Array) => {
    try {
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
      const count = doc.getPageCount();
      const list = [];
      for (let i = 0; i < count; i++) {
        const page = doc.getPage(i);
        list.push({
          pageNumber: i + 1,
          width: Math.round(page.getWidth()),
          height: Math.round(page.getHeight()),
          rotation: page.getRotation().angle,
        });
      }
      setPageDetails(list);
    } catch (e) {
      console.warn('Could not inspect individual pages:', e);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newFiles = Array.from(e.target.files);
    if (tool.multiFile) {
      setFiles((prev) => [...prev, ...newFiles]);
    } else {
      setFiles([newFiles[0]]);
    }
    resetResults();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!e.dataTransfer.files) return;
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (droppedFiles.length === 0) {
      setErrorMessage('Please upload valid PDF files.');
      return;
    }
    if (tool.multiFile) {
      setFiles((prev) => [...prev, ...droppedFiles]);
    } else {
      setFiles([droppedFiles[0]]);
    }
    resetResults();
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    resetResults();
  };

  const moveFileUp = (index: number) => {
    if (index === 0) return;
    setFiles((prev) => {
      const copy = [...prev];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
    resetResults();
  };

  const moveFileDown = (index: number) => {
    if (index === files.length - 1) return;
    setFiles((prev) => {
      const copy = [...prev];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
    resetResults();
  };

  // Client-side fallback using pdf-lib in case server endpoint fails or is unreachable
  const processClientSide = async (): Promise<Uint8Array | PdfMetadata> => {
    if (tool.id === 'merge') {
      const mergedPdf = await PDFDocument.create();
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const donorPdf = await PDFDocument.load(buffer, {
          ignoreEncryption: true,
          throwOnInvalidObject: false,
          capNumbers: true,
        });
        const pageIndices = donorPdf.getPageIndices();
        if (pageIndices.length > 0) {
          const pages = await mergedPdf.copyPages(donorPdf, pageIndices);
          pages.forEach((p) => mergedPdf.addPage(p));
        }
      }
      return await mergedPdf.save({ useObjectStreams: false });
    }

    if (tool.id === 'split') {
      const buffer = await files[0].arrayBuffer();
      const donorPdf = await PDFDocument.load(buffer, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        capNumbers: true,
      });
      const totalPages = donorPdf.getPageCount();
      const targetIndices: number[] = [];

      if (splitPages.toLowerCase() === 'all') {
        donorPdf.getPageIndices().forEach((i) => targetIndices.push(i));
      } else {
        const segments = splitPages.split(',');
        for (const seg of segments) {
          const trimmed = seg.trim();
          if (trimmed.includes('-')) {
            const [s, e] = trimmed.split('-');
            const start = Math.max(1, parseInt(s, 10));
            const end = Math.min(totalPages, parseInt(e, 10));
            for (let p = start; p <= end; p++) targetIndices.push(p - 1);
          } else {
            const p = parseInt(trimmed, 10);
            if (!isNaN(p) && p >= 1 && p <= totalPages) targetIndices.push(p - 1);
          }
        }
      }

      const outputPdf = await PDFDocument.create();
      const copied = await outputPdf.copyPages(donorPdf, targetIndices.length ? targetIndices : [0]);
      copied.forEach((p) => outputPdf.addPage(p));
      return await outputPdf.save({ useObjectStreams: false });
    }

    if (tool.id === 'rotate') {
      const buffer = await files[0].arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        capNumbers: true,
      });
      const angle = parseInt(rotateAngle, 10);
      pdfDoc.getPages().forEach((p) => {
        const cur = p.getRotation().angle;
        p.setRotation(degrees((cur + angle) % 360));
      });
      return await pdfDoc.save({ useObjectStreams: false });
    }

    if (tool.id === 'page-numbers') {
      const buffer = await files[0].arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        capNumbers: true,
      });
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();
      const totalPages = pages.length;
      const start = parseInt(startingNumber, 10);
      const fontSize = 10;

      pages.forEach((page, idx) => {
        const { width } = page.getSize();
        const num = start + idx;
        const text = `${numberPrefix}${num} / ${totalPages + start - 1}`;
        const textWidth = font.widthOfTextAtSize(text, fontSize);

        let x = (width - textWidth) / 2;
        if (pageNumberPosition === 'bottom-left') x = 36;
        if (pageNumberPosition === 'bottom-right') x = width - textWidth - 36;

        page.drawText(text, {
          x,
          y: 24,
          size: fontSize,
          font,
          color: rgb(0.2, 0.2, 0.2),
        });
      });
      return await pdfDoc.save({ useObjectStreams: false });
    }

    if (tool.id === 'watermark') {
      const buffer = await files[0].arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        capNumbers: true,
      });
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const pages = pdfDoc.getPages();
      const fontSize = parseInt(watermarkFontSize, 10);
      const opacity = parseFloat(watermarkOpacity);

      pages.forEach((page) => {
        const { width, height } = page.getSize();
        const textWidth = font.widthOfTextAtSize(watermarkText, fontSize);
        const textHeight = font.heightAtSize(fontSize);

        page.drawText(watermarkText, {
          x: width / 2 - textWidth / 2,
          y: height / 2 - textHeight / 2,
          size: fontSize,
          font,
          color: rgb(0.7, 0.1, 0.1),
          opacity,
          rotate: degrees(45),
        });
      });
      return await pdfDoc.save({ useObjectStreams: false });
    }

    if (tool.id === 'compress') {
      const buffer = await files[0].arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        capNumbers: true,
      });
      return await pdfDoc.save({ useObjectStreams: true });
    }

    if (tool.id === 'info') {
      const buffer = await files[0].arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        capNumbers: true,
      });
      return {
        title: pdfDoc.getTitle() || 'Untitled',
        author: pdfDoc.getAuthor() || 'Unknown',
        subject: pdfDoc.getSubject() || '',
        creator: pdfDoc.getCreator() || 'Stirling-PDF Client',
        producer: pdfDoc.getProducer() || 'pdf-lib',
        creationDate: pdfDoc.getCreationDate()?.toISOString() || null,
        modificationDate: pdfDoc.getModificationDate()?.toISOString() || null,
        pageCount: pdfDoc.getPageCount(),
        fileSize: files[0].size,
      };
    }

    throw new Error('Unsupported tool');
  };

  const handleExecute = async () => {
    if (files.length === 0) {
      setErrorMessage('Please select or drop at least one PDF file.');
      return;
    }

    if (tool.id === 'merge' && files.length < 2) {
      setErrorMessage('Please select at least 2 PDF files to merge together.');
      return;
    }

    setIsProcessing(true);
    resetResults();

    const formData = new FormData();
    if (tool.multiFile) {
      files.forEach((file) => formData.append('fileInput', file));
    } else {
      formData.append('fileInput', files[0]);
    }

    // Attach parameters
    if (tool.id === 'split') formData.append('pages', splitPages);
    if (tool.id === 'rotate') formData.append('angle', rotateAngle);
    if (tool.id === 'page-numbers') {
      formData.append('position', pageNumberPosition);
      formData.append('startingNumber', startingNumber);
      formData.append('customText', numberPrefix);
    }
    if (tool.id === 'watermark') {
      formData.append('watermarkText', watermarkText);
      formData.append('opacity', watermarkOpacity);
      formData.append('fontSize', watermarkFontSize);
    }

    try {
      const response = await fetch(tool.endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json, application/pdf',
        },
        body: formData,
      });

      if (!response.ok) {
        let errMessage = `Server error (${response.status})`;
        try {
          const errData = await response.json();
          if (errData.error) errMessage = errData.error;
        } catch (_) {}
        throw new Error(errMessage);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (tool.id === 'info') {
          setPdfInfo(data);
        } else {
          setServerPreviewUrl(data.previewUrl);
          setServerDownloadUrl(data.downloadUrl);
          setProcessedPageCount(data.pageCount);
          setProcessedFileSize(data.fileSize);
          const fname = data.filename || `${tool.id}_output.pdf`;
          setResultFileName(fname);

          // Pre-fetch the bytes in the background via AJAX so downloading is instantaneous and non-navigating
          if (data.downloadUrl) {
            try {
              const fileRes = await fetch(data.downloadUrl);
              if (fileRes.ok) {
                const arrayBuf = await fileRes.arrayBuffer();
                const bytes = new Uint8Array(arrayBuf);
                setProcessedBytes(bytes);
                await loadPageDetails(bytes);
              }
            } catch (fetchErr) {
              console.warn('Pre-fetching download bytes failed, will fetch on-demand:', fetchErr);
            }
          }
        }
      } else {
        // Binary response with header indicators
        const previewHeader = response.headers.get('X-Preview-Url');
        const downloadHeader = response.headers.get('X-Download-Url');
        const pageCountHeader = response.headers.get('X-Page-Count');

        const arrayBuf = await response.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuf);
        setProcessedBytes(uint8);
        setProcessedFileSize(uint8.byteLength);
        if (pageCountHeader) setProcessedPageCount(parseInt(pageCountHeader, 10));
        if (previewHeader) setServerPreviewUrl(previewHeader);
        if (downloadHeader) setServerDownloadUrl(downloadHeader);
        setResultFileName(`${tool.id}_output.pdf`);
        await loadPageDetails(uint8);
      }
    } catch (err: any) {
      console.warn('Backend endpoint failed, invoking in-browser PDF processor...', err);
      try {
        const result = await processClientSide();
        if (tool.id === 'info') {
          setPdfInfo(result as PdfMetadata);
        } else {
          const uint8 = result as Uint8Array;
          setProcessedBytes(uint8);
          setProcessedFileSize(uint8.byteLength);
          setResultFileName(`${tool.id}_output.pdf`);
          await loadPageDetails(uint8);
        }
      } catch (fallbackErr: any) {
        setErrorMessage(fallbackErr.message || err.message || 'Operation failed. Please verify the PDF format.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = async () => {
    try {
      setIsDownloading(true);
      let bytes = processedBytes;

      if (!bytes && serverDownloadUrl) {
        // Fetch via AJAX to avoid ANY iframe navigation
        const res = await fetch(serverDownloadUrl);
        if (!res.ok) throw new Error(`Download failed with status ${res.status}`);
        const buffer = await res.arrayBuffer();
        bytes = new Uint8Array(buffer);
        setProcessedBytes(bytes);
      }

      if (bytes) {
        // Create an octet-stream blob: Chrome will strictly save as file, NEVER opening PDF viewer
        const blob = new Blob([bytes as any], { type: 'application/octet-stream' });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = resultFileName || `${tool.id}_output.pdf`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
        }, 1500);
      }
    } catch (err: any) {
      console.error('Download execution failed:', err);
      setErrorMessage(`Download error: ${err.message || 'Could not download file'}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpenPreviewTab = () => {
    if (serverPreviewUrl) {
      window.open(serverPreviewUrl, '_blank', 'noopener,noreferrer');
    } else if (processedBytes) {
      const blob = new Blob([processedBytes as any], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    }
  };

  const hasResult = (processedBytes !== null || serverPreviewUrl !== null || serverDownloadUrl !== null) && tool.id !== 'info';

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Navigation header */}
      <button
        id="back-to-dashboard-btn"
        onClick={onBack}
        className="inline-flex items-center text-sm font-medium text-neutral-600 hover:text-neutral-900 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1.5" />
        Back to Dashboard
      </button>

      {/* Main card */}
      <div className="bg-white border border-neutral-200 rounded-2xl shadow-xs overflow-hidden">
        {/* Tool Header */}
        <div className="p-6 border-b border-neutral-200 bg-neutral-50/50">
          <div className="flex items-center space-x-3">
            <span className="text-3xl">{tool.icon}</span>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-bold text-neutral-900">{tool.name}</h1>
                <span className="px-2 py-0.5 text-xs font-semibold uppercase tracking-wider rounded bg-neutral-200 text-neutral-700">
                  {tool.category}
                </span>
              </div>
              <p className="text-sm text-neutral-600 mt-1">{tool.description}</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* File Upload Area */}
          <div>
            <label className="block text-sm font-semibold text-neutral-800 mb-2">
              {tool.multiFile ? 'Select or Drop PDF Files to Merge' : 'Select or Drop PDF File'}
            </label>
            <div
              id="pdf-drop-zone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-neutral-300 hover:border-red-500 rounded-xl p-8 text-center cursor-pointer transition-colors bg-neutral-50/40 hover:bg-red-50/20"
            >
              <UploadCloud className="w-10 h-10 mx-auto text-neutral-400 mb-3" />
              <p className="text-sm font-medium text-neutral-700">
                Click to browse or drag and drop your {tool.multiFile ? 'PDF files' : 'PDF file'} here
              </p>
              <p className="text-xs text-neutral-500 mt-1">Supports standard PDF documents up to 50MB</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                multiple={tool.multiFile}
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </div>

          {/* Uploaded File List */}
          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-neutral-500 font-medium">
                <span>Selected Files ({files.length})</span>
                {tool.id === 'merge' && files.length > 1 && (
                  <span className="text-neutral-400">Order from top to bottom determines merged sequence</span>
                )}
              </div>
              <div className="divide-y divide-neutral-100 border border-neutral-200 rounded-xl overflow-hidden bg-white">
                {files.map((file, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 text-sm hover:bg-neutral-50 transition-colors">
                    <div className="flex items-center space-x-3 truncate">
                      <span className="w-6 h-6 flex items-center justify-center bg-neutral-100 text-neutral-600 rounded text-xs font-mono font-semibold shrink-0">
                        {idx + 1}
                      </span>
                      <FileText className="w-4 h-4 text-red-600 shrink-0" />
                      <span className="font-medium text-neutral-800 truncate">{file.name}</span>
                      <span className="text-xs text-neutral-400 shrink-0">
                        {(file.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    <div className="flex items-center space-x-1 shrink-0 ml-2">
                      {tool.id === 'merge' && files.length > 1 && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              moveFileUp(idx);
                            }}
                            disabled={idx === 0}
                            title="Move Up"
                            className="p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-30 rounded hover:bg-neutral-100"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              moveFileDown(idx);
                            }}
                            disabled={idx === files.length - 1}
                            title="Move Down"
                            className="p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-30 rounded hover:bg-neutral-100"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(idx);
                        }}
                        className="p-1 text-neutral-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dynamic Configuration per tool */}
          {tool.id === 'split' && (
            <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 space-y-3">
              <label className="block text-sm font-semibold text-neutral-800">
                Pages to Extract
              </label>
              <input
                type="text"
                value={splitPages}
                onChange={(e) => setSplitPages(e.target.value)}
                placeholder="e.g., 1-3, 5, or all"
                className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-red-500"
              />
              <p className="text-xs text-neutral-500">
                Specify page numbers or ranges (e.g., "1-2, 4"). Use "all" to copy all pages.
              </p>
            </div>
          )}

          {tool.id === 'rotate' && (
            <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 space-y-3">
              <label className="block text-sm font-semibold text-neutral-800">
                Rotation Angle
              </label>
              <div className="grid grid-cols-3 gap-3">
                {['90', '180', '270'].map((angle) => (
                  <button
                    key={angle}
                    type="button"
                    onClick={() => setRotateAngle(angle)}
                    className={`py-2 text-sm font-medium rounded-lg border transition-colors ${
                      rotateAngle === angle
                        ? 'bg-red-600 border-red-600 text-white'
                        : 'bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    {angle}° Clockwise
                  </button>
                ))}
              </div>
            </div>
          )}

          {tool.id === 'page-numbers' && (
            <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-neutral-800 mb-1">
                  Prefix Text
                </label>
                <input
                  type="text"
                  value={numberPrefix}
                  onChange={(e) => setNumberPrefix(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-neutral-800 mb-1">
                    Starting Number
                  </label>
                  <input
                    type="number"
                    value={startingNumber}
                    onChange={(e) => setStartingNumber(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-neutral-800 mb-1">
                    Position
                  </label>
                  <select
                    value={pageNumberPosition}
                    onChange={(e) => setPageNumberPosition(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-red-500"
                  >
                    <option value="bottom-left">Bottom Left</option>
                    <option value="bottom-center">Bottom Center</option>
                    <option value="bottom-right">Bottom Right</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {tool.id === 'watermark' && (
            <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-neutral-800 mb-1">
                  Watermark Text
                </label>
                <input
                  type="text"
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  placeholder="e.g. DRAFT, CONFIDENTIAL"
                  className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-neutral-800 mb-1">
                    Font Size
                  </label>
                  <input
                    type="number"
                    value={watermarkFontSize}
                    onChange={(e) => setWatermarkFontSize(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm text-neutral-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-neutral-800 mb-1">
                    Opacity ({watermarkOpacity})
                  </label>
                  <input
                    type="range"
                    min="0.05"
                    max="1"
                    step="0.05"
                    value={watermarkOpacity}
                    onChange={(e) => setWatermarkOpacity(e.target.value)}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3 text-red-800">
              <AlertCircle className="w-5 h-5 mt-0.5 text-red-600 shrink-0" />
              <div className="text-sm">
                <span className="font-semibold block">Execution Error</span>
                <span>{errorMessage}</span>
              </div>
            </div>
          )}

          {/* Action Button */}
          <div>
            <button
              id="execute-tool-btn"
              onClick={handleExecute}
              disabled={isProcessing || files.length === 0 || (tool.id === 'merge' && files.length < 2)}
              className={`w-full py-3.5 px-4 rounded-xl font-semibold text-white flex items-center justify-center space-x-2 shadow-xs transition-all ${
                isProcessing || files.length === 0 || (tool.id === 'merge' && files.length < 2)
                  ? 'bg-neutral-400 cursor-not-allowed'
                  : 'bg-red-600 hover:bg-red-700 active:scale-[0.99]'
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Processing Documents...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-5 h-5" />
                  <span>Execute {tool.name}</span>
                </>
              )}
            </button>
            {tool.id === 'merge' && files.length === 1 && (
              <p className="text-xs text-amber-600 text-center mt-2">
                Please add at least one more PDF file to perform the merge operation.
              </p>
            )}
          </div>

          {/* Success Result Card */}
          {hasResult && (
            <div className="p-6 bg-green-50 border border-green-200 rounded-2xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5 text-green-900 font-bold text-base">
                  <CheckCircle2 className="w-6 h-6 text-green-600" />
                  <span>{tool.name} Completed Successfully!</span>
                </div>
                {processedFileSize && (
                  <span className="text-xs px-2.5 py-1 bg-green-100 text-green-800 font-semibold rounded-full">
                    {(processedFileSize / 1024).toFixed(1)} KB
                  </span>
                )}
              </div>

              <div className="text-xs text-green-800 space-y-1 bg-green-100/50 p-3 rounded-xl">
                <div className="flex justify-between">
                  <span className="text-green-700">Output File:</span>
                  <span className="font-mono font-semibold">{resultFileName}</span>
                </div>
                {processedPageCount !== null && (
                  <div className="flex justify-between">
                    <span className="text-green-700">Total Page Count:</span>
                    <span className="font-semibold">{processedPageCount} pages</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  id="download-processed-pdf-btn"
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="inline-flex items-center px-4 py-2.5 bg-green-700 hover:bg-green-800 disabled:bg-neutral-400 text-white text-sm font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving File...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Download PDF
                    </>
                  )}
                </button>

                {serverPreviewUrl && (
                  <button
                    id="open-pdf-tab-btn"
                    onClick={handleOpenPreviewTab}
                    className="inline-flex items-center px-4 py-2.5 bg-white hover:bg-neutral-50 text-neutral-800 text-sm font-semibold rounded-xl border border-neutral-300 shadow-xs transition-colors cursor-pointer"
                  >
                    <ExternalLink className="w-4 h-4 mr-2 text-neutral-600" />
                    Open in New Tab
                  </button>
                )}

                {pageDetails.length > 0 && (
                  <button
                    id="toggle-page-inspector-btn"
                    onClick={() => setShowPageInspector((prev) => !prev)}
                    className="inline-flex items-center px-4 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm font-medium rounded-xl transition-colors cursor-pointer"
                  >
                    <Eye className="w-4 h-4 mr-2 text-neutral-500" />
                    {showPageInspector ? 'Hide Page Details' : 'Inspect Pages'}
                  </button>
                )}
              </div>

              {/* Document Page Inspector */}
              {showPageInspector && pageDetails.length > 0 && (
                <div className="mt-4 pt-4 border-t border-green-200 space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold text-neutral-700">
                    <div className="flex items-center space-x-1.5">
                      <FileText className="w-4 h-4 text-green-700" />
                      <span>Document Page Summary ({pageDetails.length} pages)</span>
                    </div>
                    <button
                      onClick={() => setShowPageInspector(false)}
                      className="text-neutral-400 hover:text-neutral-700 p-1"
                      aria-label="Close page inspector"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-72 overflow-y-auto p-2 bg-white rounded-xl border border-green-200 shadow-inner">
                    {pageDetails.map((p) => {
                      const isLandscape = p.width > p.height;
                      return (
                        <div
                          key={p.pageNumber}
                          className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 flex flex-col items-center text-center space-y-2"
                        >
                          <div
                            className={`border border-neutral-300 bg-white rounded flex items-center justify-center text-neutral-500 text-[10px] font-bold shadow-2xs ${
                              isLandscape ? 'w-16 h-11' : 'w-11 h-16'
                            }`}
                          >
                            P.{p.pageNumber}
                          </div>
                          <div className="text-[11px] leading-tight">
                            <span className="font-semibold text-neutral-800 block">Page {p.pageNumber}</span>
                            <span className="text-neutral-500 block text-[10px]">
                              {p.width} × {p.height} pt
                            </span>
                            {p.rotation !== 0 && (
                              <span className="text-amber-600 font-medium block text-[10px]">
                                {p.rotation}° Rotated
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PDF Metadata Inspection Display */}
          {pdfInfo && (
            <div className="p-5 bg-white border border-neutral-200 rounded-xl space-y-3">
              <div className="flex items-center space-x-2 text-neutral-900 font-semibold pb-2 border-b border-neutral-100">
                <FileText className="w-5 h-5 text-red-600" />
                <span>PDF Document Properties</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-2.5 bg-neutral-50 rounded-lg">
                  <span className="text-neutral-500 block">Title</span>
                  <span className="font-semibold text-neutral-900 truncate block">{pdfInfo.title}</span>
                </div>
                <div className="p-2.5 bg-neutral-50 rounded-lg">
                  <span className="text-neutral-500 block">Total Pages</span>
                  <span className="font-semibold text-neutral-900 block">{pdfInfo.pageCount}</span>
                </div>
                <div className="p-2.5 bg-neutral-50 rounded-lg">
                  <span className="text-neutral-500 block">Author</span>
                  <span className="font-semibold text-neutral-900 truncate block">{pdfInfo.author}</span>
                </div>
                <div className="p-2.5 bg-neutral-50 rounded-lg">
                  <span className="text-neutral-500 block">Creator</span>
                  <span className="font-semibold text-neutral-900 truncate block">{pdfInfo.creator}</span>
                </div>
                <div className="p-2.5 bg-neutral-50 rounded-lg">
                  <span className="text-neutral-500 block">File Size</span>
                  <span className="font-semibold text-neutral-900 block">
                    {(pdfInfo.fileSize / 1024).toFixed(1)} KB
                  </span>
                </div>
                <div className="p-2.5 bg-neutral-50 rounded-lg">
                  <span className="text-neutral-500 block">Producer</span>
                  <span className="font-semibold text-neutral-900 truncate block">{pdfInfo.producer}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
