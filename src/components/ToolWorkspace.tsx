import React, { useState, useRef } from 'react';
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successResultUrl, setSuccessResultUrl] = useState<string | null>(null);
  const [resultFileName, setResultFileName] = useState<string>('output.pdf');
  const [pdfInfo, setPdfInfo] = useState<PdfMetadata | null>(null);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newFiles = Array.from(e.target.files);
    if (tool.multiFile) {
      setFiles((prev) => [...prev, ...newFiles]);
    } else {
      setFiles([newFiles[0]]);
    }
    setErrorMessage(null);
    setSuccessResultUrl(null);
    setPdfInfo(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!e.dataTransfer.files) return;
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === 'application/pdf' || f.name.endsWith('.pdf')
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
    setErrorMessage(null);
    setSuccessResultUrl(null);
    setPdfInfo(null);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setSuccessResultUrl(null);
    setPdfInfo(null);
  };

  // Client-side fallback using pdf-lib in case server endpoint fails or is unreachable
  const processClientSide = async (): Promise<Uint8Array | PdfMetadata> => {
    if (tool.id === 'merge') {
      const mergedPdf = await PDFDocument.create();
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const donorPdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const pages = await mergedPdf.copyPages(donorPdf, donorPdf.getPageIndices());
        pages.forEach((p) => mergedPdf.addPage(p));
      }
      return await mergedPdf.save();
    }

    if (tool.id === 'split') {
      const buffer = await files[0].arrayBuffer();
      const donorPdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
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
      return await outputPdf.save();
    }

    if (tool.id === 'rotate') {
      const buffer = await files[0].arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const angle = parseInt(rotateAngle, 10);
      pdfDoc.getPages().forEach((p) => {
        const cur = p.getRotation().angle;
        p.setRotation(degrees((cur + angle) % 360));
      });
      return await pdfDoc.save();
    }

    if (tool.id === 'page-numbers') {
      const buffer = await files[0].arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();
      const startNum = parseInt(startingNumber, 10) || 1;
      const total = pages.length;

      pages.forEach((page, idx) => {
        const { width } = page.getSize();
        const text = `${numberPrefix}${startNum + idx} / ${total + startNum - 1}`;
        const textWidth = font.widthOfTextAtSize(text, 10);
        let x = (width - textWidth) / 2;
        if (pageNumberPosition === 'bottom-left') x = 36;
        if (pageNumberPosition === 'bottom-right') x = width - textWidth - 36;

        page.drawText(text, {
          x,
          y: 24,
          size: 10,
          font,
          color: rgb(0.2, 0.2, 0.2),
        });
      });
      return await pdfDoc.save();
    }

    if (tool.id === 'watermark') {
      const buffer = await files[0].arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const size = parseInt(watermarkFontSize, 10) || 48;
      const opacity = parseFloat(watermarkOpacity) || 0.25;

      pdfDoc.getPages().forEach((page) => {
        const { width, height } = page.getSize();
        const textWidth = font.widthOfTextAtSize(watermarkText, size);
        page.drawText(watermarkText, {
          x: width / 2 - textWidth / 2,
          y: height / 2 - size / 2,
          size,
          font,
          color: rgb(0.7, 0.1, 0.1),
          opacity,
          rotate: degrees(45),
        });
      });
      return await pdfDoc.save();
    }

    if (tool.id === 'compress') {
      const buffer = await files[0].arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      return await pdfDoc.save({ useObjectStreams: true });
    }

    if (tool.id === 'info') {
      const buffer = await files[0].arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      return {
        title: pdfDoc.getTitle() || 'Untitled',
        author: pdfDoc.getAuthor() || 'Unknown',
        subject: pdfDoc.getSubject() || '',
        creator: pdfDoc.getCreator() || 'Stirling-PDF',
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

    setIsProcessing(true);
    setErrorMessage(null);
    setSuccessResultUrl(null);
    setPdfInfo(null);

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
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      if (tool.id === 'info') {
        const data = await response.json();
        setPdfInfo(data);
      } else {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setSuccessResultUrl(url);
        setResultFileName(`${tool.id}_output.pdf`);
      }
    } catch (err: any) {
      console.warn('Backend endpoint failed, invoking in-browser PDF processor...', err);
      try {
        const result = await processClientSide();
        if (tool.id === 'info') {
          setPdfInfo(result as PdfMetadata);
        } else {
          const uint8 = result as Uint8Array;
          const blob = new Blob([uint8.buffer as ArrayBuffer], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          setSuccessResultUrl(url);
          setResultFileName(`${tool.id}_output.pdf`);
        }
      } catch (fallbackErr: any) {
        setErrorMessage(fallbackErr.message || 'Operation failed. Please verify the PDF format.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Navigation header */}
      <button
        id="back-to-tools-btn"
        onClick={onBack}
        className="inline-flex items-center text-sm font-medium text-neutral-600 hover:text-neutral-900 mb-6 group transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
        Back to all tools
      </button>

      <div className="bg-white rounded-xl border border-neutral-200 shadow-xs overflow-hidden">
        {/* Workspace Title */}
        <div className="p-6 border-b border-neutral-100 bg-neutral-50/50 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-neutral-900">{tool.name}</h2>
            <p className="text-sm text-neutral-600 mt-0.5">{tool.description}</p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-neutral-200 text-neutral-700">
            {tool.endpoint}
          </span>
        </div>

        <div className="p-6 space-y-6">
          {/* File Upload Zone */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              {tool.multiFile ? 'Upload PDF Documents (Multiple supported)' : 'Select PDF Document'}
            </label>
            <div
              id="pdf-drop-zone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-neutral-300 hover:border-red-400 rounded-xl p-8 text-center cursor-pointer transition-colors bg-neutral-50/40 hover:bg-red-50/20"
            >
              <UploadCloud className="w-10 h-10 text-red-600 mx-auto mb-3" />
              <p className="text-sm font-semibold text-neutral-800">
                Click to browse or drag and drop your PDF here
              </p>
              <p className="text-xs text-neutral-500 mt-1">Accepts standard PDF files up to 50MB</p>
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

          {/* Selected Files List */}
          {files.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                Selected Files ({files.length})
              </span>
              <div className="divide-y divide-neutral-100 border border-neutral-200 rounded-lg overflow-hidden bg-white">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between p-3 text-sm">
                    <div className="flex items-center space-x-3 truncate">
                      <FileText className="w-5 h-5 text-red-600 shrink-0" />
                      <div className="truncate">
                        <p className="font-medium text-neutral-900 truncate">{f.name}</p>
                        <p className="text-xs text-neutral-500">{(f.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeFile(i)}
                      className="p-1.5 text-neutral-400 hover:text-red-600 rounded-md transition-colors"
                      title="Remove file"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tool-specific Parameters */}
          {tool.id === 'split' && (
            <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200">
              <label className="block text-sm font-semibold text-neutral-800 mb-1">
                Pages to Extract
              </label>
              <p className="text-xs text-neutral-500 mb-2">
                Specify pages or page ranges separated by commas (e.g. <code>1-3, 5</code> or <code>all</code>)
              </p>
              <input
                id="split-pages-input"
                type="text"
                value={splitPages}
                onChange={(e) => setSplitPages(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-neutral-300 bg-white focus:ring-2 focus:ring-red-500 focus:outline-none"
              />
            </div>
          )}

          {tool.id === 'rotate' && (
            <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200">
              <label className="block text-sm font-semibold text-neutral-800 mb-2">
                Rotation Angle
              </label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { angle: '90', label: '90° Clockwise' },
                  { angle: '180', label: '180° Half Turn' },
                  { angle: '270', label: '270° Counter-CW' },
                ].map((item) => (
                  <button
                    key={item.angle}
                    type="button"
                    onClick={() => setRotateAngle(item.angle)}
                    className={`py-2 text-sm font-medium rounded-md border transition-all ${
                      rotateAngle === item.angle
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-100'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tool.id === 'page-numbers' && (
            <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-neutral-800 mb-1">Position</label>
                <select
                  id="page-num-position"
                  value={pageNumberPosition}
                  onChange={(e) => setPageNumberPosition(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-neutral-300 bg-white focus:ring-2 focus:ring-red-500 focus:outline-none"
                >
                  <option value="bottom-center">Bottom Center</option>
                  <option value="bottom-right">Bottom Right</option>
                  <option value="bottom-left">Bottom Left</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-neutral-800 mb-1">Prefix Text</label>
                  <input
                    type="text"
                    value={numberPrefix}
                    onChange={(e) => setNumberPrefix(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-md border border-neutral-300 bg-white focus:ring-2 focus:ring-red-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-neutral-800 mb-1">Starting Number</label>
                  <input
                    type="number"
                    min="1"
                    value={startingNumber}
                    onChange={(e) => setStartingNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-md border border-neutral-300 bg-white focus:ring-2 focus:ring-red-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {tool.id === 'watermark' && (
            <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-neutral-800 mb-1">Watermark Text</label>
                <input
                  id="watermark-text-input"
                  type="text"
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-neutral-300 bg-white focus:ring-2 focus:ring-red-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between text-xs text-neutral-600 mb-1">
                    <span className="font-semibold">Opacity</span>
                    <span>{Math.round(parseFloat(watermarkOpacity) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={watermarkOpacity}
                    onChange={(e) => setWatermarkOpacity(e.target.value)}
                    className="w-full accent-red-600"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs text-neutral-600 mb-1">
                    <span className="font-semibold">Font Size</span>
                    <span>{watermarkFontSize} pt</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="96"
                    step="4"
                    value={watermarkFontSize}
                    onChange={(e) => setWatermarkFontSize(e.target.value)}
                    className="w-full accent-red-600"
                  />
                </div>
              </div>
            </div>
          )}

          {tool.id === 'compress' && (
            <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 text-sm text-neutral-600">
              Stirling PDF optimizes embedded object streams, flattens redundant dictionary tags, and recompresses structural streams without compromising font rendering.
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg flex items-center space-x-2 text-red-700 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Button */}
          <div>
            <button
              id="execute-tool-btn"
              onClick={handleExecute}
              disabled={isProcessing || files.length === 0}
              className={`w-full py-3 px-4 rounded-lg font-semibold text-white flex items-center justify-center space-x-2 shadow-xs transition-all ${
                isProcessing || files.length === 0
                  ? 'bg-neutral-400 cursor-not-allowed'
                  : 'bg-red-600 hover:bg-red-700 active:scale-[0.99]'
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Processing Document...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-5 h-5" />
                  <span>Execute {tool.name}</span>
                </>
              )}
            </button>
          </div>

          {/* Success Download Card */}
          {successResultUrl && (
            <div className="p-5 bg-green-50 border border-green-200 rounded-xl space-y-4">
              <div className="flex items-center space-x-2 text-green-800 font-semibold">
                <CheckCircle2 className="w-5 h-5" />
                <span>Processing Completed Successfully!</span>
              </div>
              <p className="text-xs text-green-700">
                Your PDF has been processed and is ready for download or preview.
              </p>
              <div className="flex items-center space-x-3">
                <a
                  id="download-processed-pdf-btn"
                  href={successResultUrl}
                  download={resultFileName}
                  className="inline-flex items-center px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold rounded-lg shadow-xs transition-colors"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF
                </a>
                <a
                  href={successResultUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center px-4 py-2 bg-white hover:bg-neutral-100 text-neutral-800 text-sm font-semibold rounded-lg border border-neutral-300 shadow-xs transition-colors"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Preview
                </a>
              </div>
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
