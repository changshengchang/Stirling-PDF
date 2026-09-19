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
  Type,
  Underline as UnderlineIcon,
  Palette,
  MousePointer,
  Highlighter,
  Strikethrough,
  Square,
  Image as ImageIcon,
  ClipboardPaste,
  Plus,
  Layers,
} from 'lucide-react';
import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PdfTool, PdfMetadata, TextAnnotationItem, MarkupAnnotationItem, PastedImageItem } from '../types';

const PdfVisualPlacement = React.lazy(() =>
  import('./PdfVisualPlacement').then((m) => ({ default: m.PdfVisualPlacement }))
);

let cachedCjkFontBytes: Uint8Array | null = null;
async function getClientCjkFontBytes(): Promise<Uint8Array | null> {
  if (cachedCjkFontBytes) return cachedCjkFontBytes;
  // Try static route first, then fall back to backend API
  try {
    const res = await fetch('/fonts/NotoSansTC-Regular.ttf');
    if (res.ok) {
      const arr = await res.arrayBuffer();
      cachedCjkFontBytes = new Uint8Array(arr);
      return cachedCjkFontBytes;
    }
  } catch (_) {}

  try {
    const res = await fetch('/api/v1/fonts/cjk');
    if (res.ok) {
      const arr = await res.arrayBuffer();
      cachedCjkFontBytes = new Uint8Array(arr);
      return cachedCjkFontBytes;
    }
  } catch (e) {
    console.warn('Failed to load CJK font from server:', e);
  }
  return null;
}

const customClientFontkit: any = {
  ...fontkit,
  create: (buf: any, postscriptName?: string) => {
    const res = (fontkit as any).create(buf, postscriptName);
    if (res && res.fonts && res.fonts.length > 0) {
      return res.fonts[0];
    }
    return res;
  },
};

const docCjkFontMap = new WeakMap<PDFDocument, any>();

async function getClientAppropriateFont(pdfDoc: PDFDocument, text: string, preferBold: boolean = true) {
  const hasNonAscii = /[^\u0000-\u007F]/.test(text);
  if (hasNonAscii) {
    if (docCjkFontMap.has(pdfDoc)) {
      return docCjkFontMap.get(pdfDoc);
    }
    const fontBytes = await getClientCjkFontBytes();
    if (fontBytes) {
      pdfDoc.registerFontkit(customClientFontkit);
      const font = await pdfDoc.embedFont(fontBytes, { subset: true });
      docCjkFontMap.set(pdfDoc, font);
      return font;
    }
  }
  try {
    return await pdfDoc.embedFont(preferBold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  } catch (e) {
    if (docCjkFontMap.has(pdfDoc)) {
      return docCjkFontMap.get(pdfDoc);
    }
    const fontBytes = await getClientCjkFontBytes();
    if (fontBytes) {
      pdfDoc.registerFontkit(customClientFontkit);
      const font = await pdfDoc.embedFont(fontBytes, { subset: true });
      docCjkFontMap.set(pdfDoc, font);
      return font;
    }
    throw e;
  }
}

// Helper to convert hex color (#rrggbb) to 0-1 RGB fractions
const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  const num = parseInt(clean, 16);
  if (isNaN(num) || clean.length !== 6) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
};

const COLOR_PRESETS = [
  { label: 'Black', hex: '#000000', bg: 'bg-black' },
  { label: 'Blue', hex: '#1d4ed8', bg: 'bg-blue-700' },
  { label: 'Red', hex: '#dc2626', bg: 'bg-red-600' },
  { label: 'Green', hex: '#15803d', bg: 'bg-green-700' },
  { label: 'Purple', hex: '#7e22ce', bg: 'bg-purple-700' },
  { label: 'Orange', hex: '#d97706', bg: 'bg-amber-600' },
];

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

  // Add Text, Markups & Pasted Images tool options
  const [textItems, setTextItems] = useState<TextAnnotationItem[]>([
    {
      id: 'text-1',
      text: 'Approved & Verified',
      color: '#dc2626',
      fontSize: 18,
      underline: true,
      page: 1,
      x: 80,
      y: 120,
      position: 'custom',
    },
  ]);
  const [activeTextId, setActiveTextId] = useState<string>('text-1');
  const [markups, setMarkups] = useState<MarkupAnnotationItem[]>([]);
  const [pastedImages, setPastedImages] = useState<PastedImageItem[]>([]);
  const [showVisualPlacement, setShowVisualPlacement] = useState<boolean>(true);
  const [activeConfigTab, setActiveConfigTab] = useState<'text' | 'markup' | 'image'>('text');

  // Active text item helper
  const activeTextItem = textItems.find((t) => t.id === activeTextId) || textItems[0] || {
    id: 'text-1',
    text: '',
    color: '#dc2626',
    fontSize: 18,
    underline: true,
    page: 1,
    x: 80,
    y: 120,
    position: 'custom',
  };

  const handleUpdateActiveText = (updates: Partial<TextAnnotationItem>) => {
    setTextItems((prev) =>
      prev.map((t) => (t.id === activeTextId ? { ...t, ...updates } : t))
    );
  };

  const handleAddTextGroup = () => {
    const newId = `text-${Date.now()}`;
    const newItem: TextAnnotationItem = {
      id: newId,
      text: `第 ${textItems.length + 1} 組文字`,
      color: '#1d4ed8',
      fontSize: 16,
      underline: false,
      page: 1,
      x: 80,
      y: Math.max(30, (textItems[textItems.length - 1]?.y || 120) - 35),
      position: 'custom',
    };
    setTextItems((prev) => [...prev, newItem]);
    setActiveTextId(newId);
  };

  const handleDeleteTextGroup = (id: string) => {
    if (textItems.length <= 1) return;
    setTextItems((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      if (activeTextId === id && filtered.length > 0) {
        setActiveTextId(filtered[0].id);
      }
      return filtered;
    });
  };

  // Backwards compatibility bindings
  const addTextInput = activeTextItem.text;
  const setAddTextInput = (val: string) => handleUpdateActiveText({ text: val });
  const addTextColor = activeTextItem.color;
  const setAddTextColor = (val: string) => handleUpdateActiveText({ color: val });
  const addTextUnderline = activeTextItem.underline;
  const setAddTextUnderline = (val: boolean) => handleUpdateActiveText({ underline: val });
  const addTextFontSize = activeTextItem.fontSize.toString();
  const setAddTextFontSize = (val: string) => handleUpdateActiveText({ fontSize: parseInt(val, 10) || 16 });
  const addTextPosition = activeTextItem.position || 'custom';
  const setAddTextPosition = (val: string) => handleUpdateActiveText({ position: val });
  const addTextTargetPages = activeTextItem.page.toString();
  const setAddTextTargetPages = (val: string) => handleUpdateActiveText({ page: parseInt(val, 10) || 1 });
  const addTextCustomX = activeTextItem.x.toString();
  const setAddTextCustomX = (val: string) => handleUpdateActiveText({ x: parseFloat(val) || 0 });
  const addTextCustomY = activeTextItem.y.toString();
  const setAddTextCustomY = (val: string) => handleUpdateActiveText({ y: parseFloat(val) || 0 });

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
      const font = await getClientAppropriateFont(pdfDoc, numberPrefix, false);
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
      const font = await getClientAppropriateFont(pdfDoc, watermarkText, true);
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

    if (tool.id === 'add-text') {
      const buffer = await files[0].arrayBuffer();
      const pdfDoc = await PDFDocument.load(buffer, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        capNumbers: true,
      });
      const pages = pdfDoc.getPages();
      const totalPages = pages.length;

      // 1. Draw Markups (螢光筆塗色標記、原文劃底線、刪除線、方框)
      for (const markup of markups) {
        const pageIdx = (parseInt(markup.page as any, 10) || 1) - 1;
        if (pageIdx < 0 || pageIdx >= totalPages) continue;

        const page = pages[pageIdx];
        const rgbColor = hexToRgb(markup.color || '#facc15');
        const pdfColor = rgb(rgbColor.r, rgbColor.g, rgbColor.b);
        const opacity = typeof markup.opacity === 'number' ? markup.opacity : (markup.type === 'highlight' ? 0.35 : 0.9);
        const thickness = markup.strokeWidth || 2;
        const width = Math.max(2, markup.width || 10);
        const height = Math.max(2, markup.height || 10);

        if (markup.type === 'highlight') {
          page.drawRectangle({
            x: markup.x,
            y: markup.y,
            width,
            height,
            color: pdfColor,
            opacity,
          });
        } else if (markup.type === 'underline') {
          page.drawLine({
            start: { x: markup.x, y: markup.y },
            end: { x: markup.x + width, y: markup.y },
            thickness,
            color: pdfColor,
            opacity,
          });
        } else if (markup.type === 'strike') {
          page.drawLine({
            start: { x: markup.x, y: markup.y + height / 2 },
            end: { x: markup.x + width, y: markup.y + height / 2 },
            thickness,
            color: pdfColor,
            opacity,
          });
        } else if (markup.type === 'rectangle') {
          page.drawRectangle({
            x: markup.x,
            y: markup.y,
            width,
            height,
            borderColor: pdfColor,
            borderWidth: thickness,
            opacity,
          });
        } else if (markup.type === 'mask') {
          // 100% 不透光方形隱私遮罩圖層（塗黑 / 白底 / 灰色）
          page.drawRectangle({
            x: markup.x,
            y: markup.y,
            width,
            height,
            color: pdfColor,
            opacity: 1.0,
          });
        } else if (markup.type === 'mosaic') {
          // 馬賽克隱私遮罩（像素方格陣列徹底遮蔽個資與敏感文字）
          const pixelSize = 5;
          const cols = Math.ceil(width / pixelSize);
          const rows = Math.ceil(height / pixelSize);
          const mosaicTones = [
            rgb(0.78, 0.82, 0.87),
            rgb(0.55, 0.62, 0.70),
            rgb(0.88, 0.91, 0.94),
            rgb(0.40, 0.46, 0.54),
          ];
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const blockX = markup.x + c * pixelSize;
              const blockY = markup.y + r * pixelSize;
              const blockW = Math.min(pixelSize, markup.x + width - blockX);
              const blockH = Math.min(pixelSize, markup.y + height - blockY);
              if (blockW > 0 && blockH > 0) {
                const toneIdx = (c * 7 + r * 13) % mosaicTones.length;
                page.drawRectangle({
                  x: blockX,
                  y: blockY,
                  width: blockW,
                  height: blockH,
                  color: mosaicTones[toneIdx],
                  opacity: 1.0,
                });
              }
            }
          }
          page.drawRectangle({
            x: markup.x,
            y: markup.y,
            width,
            height,
            borderColor: rgb(0.4, 0.46, 0.54),
            borderWidth: 0.5,
            opacity: 0.8,
          });
        }
      }

      // 2. Draw Pasted Screenshots & Images (插入截圖與貼上圖片)
      for (const img of pastedImages) {
        if (!img.dataUrl) continue;
        const pageIdx = (parseInt(img.page as any, 10) || 1) - 1;
        if (pageIdx < 0 || pageIdx >= totalPages) continue;
        const page = pages[pageIdx];

        const base64Data = img.dataUrl.includes('base64,') ? img.dataUrl.split('base64,')[1] : img.dataUrl;
        const binaryString = atob(base64Data);
        const imgBytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          imgBytes[i] = binaryString.charCodeAt(i);
        }

        let embeddedImage: any = null;
        try {
          if (img.dataUrl.includes('image/png') || !img.dataUrl.includes('image/jp')) {
            embeddedImage = await pdfDoc.embedPng(imgBytes);
          } else {
            embeddedImage = await pdfDoc.embedJpg(imgBytes);
          }
        } catch (e1) {
          try {
            embeddedImage = await pdfDoc.embedJpg(imgBytes);
          } catch (e2) {
            console.warn('Could not embed client-side image:', e1, e2);
          }
        }

        if (embeddedImage) {
          page.drawImage(embeddedImage, {
            x: img.x,
            y: img.y,
            width: Math.max(10, img.width || 150),
            height: Math.max(10, img.height || 100),
          });
        }
      }

      // 3. Draw Text Items (支援多組文字、中英文字型、底線、自訂位置)
      for (const item of textItems) {
        if (!item.text || !item.text.trim()) continue;

        const itemFont = await getClientAppropriateFont(pdfDoc, item.text, true);
        const rgbColor = hexToRgb(item.color || '#000000');
        const itemColor = rgb(rgbColor.r, rgbColor.g, rgbColor.b);
        const itemFontSize = Math.max(6, Math.min(120, item.fontSize || 16));
        const itemUnderline = item.underline;
        const itemBoxWidth = item.width && item.width > 20 ? item.width : undefined;
        let lines: string[] = [];
        const rawLines = item.text.split(/\r?\n/);

        if (itemBoxWidth) {
          for (const rawLine of rawLines) {
            if (!rawLine) {
              lines.push('');
              continue;
            }
            let cur = '';
            for (const ch of rawLine) {
              const test = cur + ch;
              if (cur.length > 0 && itemFont.widthOfTextAtSize(test, itemFontSize) > itemBoxWidth) {
                lines.push(cur);
                cur = ch;
              } else {
                cur = test;
              }
            }
            if (cur) lines.push(cur);
          }
        } else {
          lines = rawLines;
        }

        const lineHeight = itemFontSize * 1.35;

        const targetPageStr = (item.page || '1').toString().trim();
        let itemPages: number[] = [];
        if (targetPageStr.toLowerCase() === 'all') {
          itemPages = pages.map((_, i) => i);
        } else {
          const segments = targetPageStr.split(',');
          for (const seg of segments) {
            const trimmed = seg.trim();
            if (trimmed.includes('-')) {
              const [s, e] = trimmed.split('-');
              const start = Math.max(1, parseInt(s, 10));
              const end = Math.min(totalPages, parseInt(e, 10));
              for (let p = start; p <= end; p++) {
                if (!itemPages.includes(p - 1)) itemPages.push(p - 1);
              }
            } else {
              const num = parseInt(trimmed, 10);
              if (!isNaN(num) && num >= 1 && num <= totalPages) {
                if (!itemPages.includes(num - 1)) itemPages.push(num - 1);
              }
            }
          }
        }
        if (itemPages.length === 0) itemPages = [0];

        for (const idx of itemPages) {
          const page = pages[idx];
          const { width, height } = page.getSize();
          const lineWidths = lines.map((line) => (line.length > 0 ? itemFont.widthOfTextAtSize(line, itemFontSize) : 0));
          const maxLineWidth = Math.max(...lineWidths, 0);
          const totalBlockHeight = lines.length * lineHeight;

          let startX = isNaN(item.x) ? 50 : item.x;
          let startY = isNaN(item.y) ? 50 : item.y;

          if (item.position && item.position !== 'custom') {
            switch (item.position) {
              case 'top-left':
                startX = 50;
                startY = height - 50;
                break;
              case 'top-center':
                startX = (width - maxLineWidth) / 2;
                startY = height - 50;
                break;
              case 'top-right':
                startX = width - maxLineWidth - 50;
                startY = height - 50;
                break;
              case 'center':
                startX = (width - maxLineWidth) / 2;
                startY = (height + totalBlockHeight) / 2 - itemFontSize;
                break;
              case 'bottom-left':
                startX = 50;
                startY = totalBlockHeight + 40;
                break;
              case 'bottom-center':
                startX = (width - maxLineWidth) / 2;
                startY = totalBlockHeight + 40;
                break;
              case 'bottom-right':
                startX = width - maxLineWidth - 50;
                startY = totalBlockHeight + 40;
                break;
            }
          }

          lines.forEach((line, lineIdx) => {
            if (!line || line.trim().length === 0) return;
            const curY = startY - lineIdx * lineHeight;
            const curLineWidth = lineWidths[lineIdx];
            let curX = startX;

            if (item.position === 'top-center' || item.position === 'center' || item.position === 'bottom-center') {
              curX = (width - curLineWidth) / 2;
            } else if (item.position === 'top-right' || item.position === 'bottom-right') {
              curX = width - curLineWidth - 50;
            }

            page.drawText(line, {
              x: curX,
              y: curY,
              size: itemFontSize,
              font: itemFont,
              color: itemColor,
            });

            if (itemUnderline) {
              const underlineOffset = Math.max(2, itemFontSize * 0.15);
              const thickness = Math.max(1, itemFontSize / 14);
              page.drawLine({
                start: { x: curX, y: curY - underlineOffset },
                end: { x: curX + curLineWidth, y: curY - underlineOffset },
                thickness,
                color: itemColor,
              });
            }
          });
        }
      }

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
    if (tool.id === 'add-text') {
      formData.append('text', addTextInput);
      formData.append('color', addTextColor);
      formData.append('underline', addTextUnderline ? 'true' : 'false');
      formData.append('fontSize', addTextFontSize);
      formData.append('position', addTextPosition);
      formData.append('targetPages', addTextTargetPages);
      formData.append('x', addTextCustomX);
      formData.append('y', addTextCustomY);
      formData.append('textItems', JSON.stringify(textItems));
      formData.append('markups', JSON.stringify(markups));
      formData.append('images', JSON.stringify(pastedImages));
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

          {tool.id === 'add-text' && (
            <div className="p-5 bg-neutral-50 rounded-xl border border-neutral-200 space-y-5">
              {/* PDF Document Viewer for Visual Placement & Live Annotation */}
              {files.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-neutral-800 flex items-center space-x-1.5">
                      <MousePointer className="w-4 h-4 text-red-600" />
                      <span>PDF 頁面可視化編輯器 (多組文字 / 原文劃線塗色 / 插入截圖)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowVisualPlacement((prev) => !prev)}
                      className="text-xs font-medium text-red-600 hover:text-red-700 underline cursor-pointer"
                    >
                      {showVisualPlacement ? '隱藏頁面檢視器' : '展開頁面檢視器'}
                    </button>
                  </div>

                  {showVisualPlacement && (
                    <React.Suspense
                      fallback={
                        <div className="p-12 text-center bg-white rounded-xl border border-neutral-200 text-neutral-500 text-xs flex flex-col items-center justify-center space-y-2">
                          <Loader2 className="w-6 h-6 animate-spin text-red-600" />
                          <span>正在載入 PDF 可視化編輯畫布...</span>
                        </div>
                      }
                    >
                      <PdfVisualPlacement
                        file={files[0]}
                        textItems={textItems}
                        activeTextId={activeTextId}
                        onSelectActiveText={(id: string) => setActiveTextId(id)}
                        onUpdateTextPosition={(id, x, y, page) => {
                          setTextItems((prev) =>
                            prev.map((t) => (t.id === id ? { ...t, x, y, page, position: 'custom' } : t))
                          );
                        }}
                        onUpdateTextItem={(id, updates) => {
                          setTextItems((prev) =>
                            prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
                          );
                          if (id === activeTextId) {
                            if (updates.text !== undefined) setAddTextInput(updates.text);
                            if (updates.color !== undefined) setAddTextColor(updates.color);
                            if (updates.fontSize !== undefined) setAddTextFontSize(updates.fontSize.toString());
                            if (updates.underline !== undefined) setAddTextUnderline(updates.underline);
                          }
                        }}
                        onAddTextItem={handleAddTextGroup}
                        onDeleteTextItem={handleDeleteTextGroup}
                        markups={markups}
                        onAddMarkup={(m) => setMarkups((prev) => [...prev, m])}
                        onUpdateMarkup={(id, updates) =>
                          setMarkups((prev) =>
                            prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
                          )
                        }
                        onDeleteMarkup={(id) => setMarkups((prev) => prev.filter((m) => m.id !== id))}
                        pastedImages={pastedImages}
                        onAddImage={(img) => setPastedImages((prev) => [...prev, img])}
                        onUpdateImage={(id, updates) =>
                          setPastedImages((prev) =>
                            prev.map((im) => (im.id === id ? { ...im, ...updates } : im))
                          )
                        }
                        onDeleteImage={(id) => setPastedImages((prev) => prev.filter((im) => im.id !== id))}
                        // Fallback props
                        text={addTextInput}
                        color={addTextColor}
                        underline={addTextUnderline}
                        fontSize={parseInt(addTextFontSize || '16', 10)}
                        customX={parseFloat(addTextCustomX) || 0}
                        customY={parseFloat(addTextCustomY) || 0}
                        targetPageStr={addTextTargetPages}
                        onPositionSelected={(x, y, pageNum) => {
                          setAddTextCustomX(x.toString());
                          setAddTextCustomY(y.toString());
                          setAddTextPosition('custom');
                          setAddTextTargetPages(pageNum.toString());
                        }}
                      />
                    </React.Suspense>
                  )}
                </div>
              )}

              {/* Module Navigation Tabs */}
              <div className="flex border-b border-neutral-200">
                <button
                  type="button"
                  onClick={() => setActiveConfigTab('text')}
                  className={`py-2.5 px-4 font-semibold text-xs flex items-center space-x-1.5 border-b-2 transition-colors cursor-pointer ${
                    activeConfigTab === 'text'
                      ? 'border-red-600 text-red-600 bg-white rounded-t-lg'
                      : 'border-transparent text-neutral-500 hover:text-neutral-800'
                  }`}
                >
                  <Type className="w-3.5 h-3.5" />
                  <span>新增文字項目 ({textItems.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveConfigTab('markup')}
                  className={`py-2.5 px-4 font-semibold text-xs flex items-center space-x-1.5 border-b-2 transition-colors cursor-pointer ${
                    activeConfigTab === 'markup'
                      ? 'border-red-600 text-red-600 bg-white rounded-t-lg'
                      : 'border-transparent text-neutral-500 hover:text-neutral-800'
                  }`}
                >
                  <Highlighter className="w-3.5 h-3.5" />
                  <span>原文標記與隱私遮罩 ({markups.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveConfigTab('image')}
                  className={`py-2.5 px-4 font-semibold text-xs flex items-center space-x-1.5 border-b-2 transition-colors cursor-pointer ${
                    activeConfigTab === 'image'
                      ? 'border-red-600 text-red-600 bg-white rounded-t-lg'
                      : 'border-transparent text-neutral-500 hover:text-neutral-800'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>插入截圖與圖片 ({pastedImages.length})</span>
                </button>
              </div>

              {/* Tab 1: Text Items Manager */}
              {activeConfigTab === 'text' && (
                <div className="space-y-4">
                  {/* Multi-Text Selector & Add Button */}
                  <div className="flex flex-wrap items-center gap-2 p-2.5 bg-white rounded-lg border border-neutral-200">
                    <span className="text-xs font-semibold text-neutral-700 mr-1 flex items-center space-x-1">
                      <Layers className="w-3.5 h-3.5 text-red-600" />
                      <span>文字項目清單：</span>
                    </span>
                    {textItems.map((item, idx) => (
                      <div
                        key={item.id}
                        className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                          activeTextId === item.id
                            ? 'bg-red-50 border-red-400 text-red-700 shadow-2xs'
                            : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                        }`}
                        onClick={() => setActiveTextId(item.id)}
                      >
                        <span
                          className="w-2 h-2 rounded-full inline-block"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="max-w-24 truncate">{item.text || `組別 #${idx + 1}`}</span>
                        {textItems.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteTextGroup(item.id);
                            }}
                            className="text-neutral-400 hover:text-red-600 ml-1"
                            title="刪除此組文字"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={handleAddTextGroup}
                      className="px-2.5 py-1 bg-neutral-900 hover:bg-black text-white text-xs font-semibold rounded-md flex items-center space-x-1 transition-colors cursor-pointer ml-auto"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>新增第 {textItems.length + 1} 組文字</span>
                    </button>
                  </div>

                  {/* Text Input */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="add-text-input" className="text-sm font-semibold text-neutral-800 flex items-center space-x-1.5">
                        <Type className="w-4 h-4 text-red-600" />
                        <span>文字內容 (目前編輯：第 {textItems.findIndex((t) => t.id === activeTextId) + 1} 組)</span>
                      </label>
                      <span className="text-xs text-neutral-400">支援多行換行輸入</span>
                    </div>
                    <textarea
                      id="add-text-input"
                      rows={2}
                      value={addTextInput}
                      onChange={(e) => setAddTextInput(e.target.value)}
                      placeholder="輸入要新增至 PDF 的文字內容..."
                      className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-red-500 placeholder:text-neutral-400"
                    />
                  </div>

                  {/* Color Selection & Underline Toggle */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Color Selection */}
                    <div className="p-3 bg-white rounded-lg border border-neutral-200 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label htmlFor="custom-color-picker" className="text-xs font-semibold text-neutral-700 flex items-center space-x-1.5">
                          <Palette className="w-3.5 h-3.5 text-neutral-500" />
                          <span>文字顏色 (Text Color)</span>
                        </label>
                        <div className="flex items-center space-x-1.5">
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-neutral-300 inline-block shadow-2xs"
                            style={{ backgroundColor: addTextColor }}
                          />
                          <span className="text-[11px] font-mono font-medium text-neutral-600 uppercase">
                            {addTextColor}
                          </span>
                        </div>
                      </div>

                      {/* Preset Colors */}
                      <div className="flex items-center space-x-2">
                        {COLOR_PRESETS.map((preset) => (
                          <button
                            key={preset.hex}
                            type="button"
                            onClick={() => setAddTextColor(preset.hex)}
                            title={`${preset.label} (${preset.hex})`}
                            className={`w-6 h-6 rounded-full border transition-transform ${preset.bg} ${
                              addTextColor.toLowerCase() === preset.hex.toLowerCase()
                                ? 'ring-2 ring-offset-1 ring-red-500 scale-110 border-white'
                                : 'border-neutral-300 hover:scale-105 opacity-90'
                            }`}
                          />
                        ))}
                        
                        {/* Custom Color Input */}
                        <label
                          htmlFor="custom-color-picker"
                          title="自訂顏色 (Custom Color)"
                          className="cursor-pointer inline-flex items-center justify-center w-6 h-6 rounded-full border border-neutral-300 bg-neutral-100 hover:bg-neutral-200 text-neutral-600 text-xs transition-colors"
                        >
                          +
                          <input
                            id="custom-color-picker"
                            type="color"
                            value={addTextColor}
                            onChange={(e) => setAddTextColor(e.target.value)}
                            className="sr-only"
                          />
                        </label>
                      </div>
                    </div>

                    {/* Underline Toggle */}
                    <div className="p-3 bg-white rounded-lg border border-neutral-200 flex flex-col justify-between">
                      <span className="text-xs font-semibold text-neutral-700 flex items-center space-x-1.5">
                        <UnderlineIcon className="w-3.5 h-3.5 text-neutral-500" />
                        <span>劃底線功能 (Underline)</span>
                      </span>

                      <div className="mt-2 flex items-center">
                        <label
                          htmlFor="toggle-underline-checkbox"
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-md border cursor-pointer select-none transition-colors ${
                            addTextUnderline
                              ? 'bg-red-50 border-red-300 text-red-800'
                              : 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                          }`}
                        >
                          <span className="text-xs font-medium flex items-center space-x-2">
                            <span className="underline font-semibold decoration-2">劃底線樣式 (Underline)</span>
                          </span>
                          <input
                            id="toggle-underline-checkbox"
                            type="checkbox"
                            checked={addTextUnderline}
                            onChange={(e) => setAddTextUnderline(e.target.checked)}
                            className="w-4 h-4 text-red-600 rounded border-neutral-300 focus:ring-red-500 cursor-pointer"
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Font Size & Position & Target Page */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label htmlFor="add-text-fontsize" className="block text-xs font-semibold text-neutral-700 mb-1">
                        字型大小 (Font Size: {addTextFontSize}pt)
                      </label>
                      <input
                        id="add-text-fontsize"
                        type="number"
                        min="8"
                        max="96"
                        value={addTextFontSize}
                        onChange={(e) => setAddTextFontSize(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-red-500"
                      />
                    </div>

                    <div>
                      <label htmlFor="add-text-position" className="block text-xs font-semibold text-neutral-700 mb-1">
                        插入位置 (Position)
                      </label>
                      <select
                        id="add-text-position"
                        value={addTextPosition}
                        onChange={(e) => setAddTextPosition(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-red-500"
                      >
                        <option value="custom">Visual Custom (可視化拖曳/自訂座標)</option>
                        <option value="bottom-center">Bottom Center (下方置中)</option>
                        <option value="bottom-left">Bottom Left (左下角)</option>
                        <option value="bottom-right">Bottom Right (右下角)</option>
                        <option value="center">Center (頁面正中)</option>
                        <option value="top-center">Top Center (上方置中)</option>
                        <option value="top-left">Top Left (左上角)</option>
                        <option value="top-right">Top Right (右上角)</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="add-text-target-pages" className="block text-xs font-semibold text-neutral-700 mb-1">
                        目標頁面 (Target Page)
                      </label>
                      <input
                        id="add-text-target-pages"
                        type="text"
                        value={addTextTargetPages}
                        onChange={(e) => setAddTextTargetPages(e.target.value)}
                        placeholder="e.g. all, 1, 1-3"
                        className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                  </div>

                  {/* Custom Coordinates when 'custom' is selected */}
                  {addTextPosition === 'custom' && (
                    <div className="grid grid-cols-2 gap-3 p-3 bg-white rounded-lg border border-neutral-200">
                      <div>
                        <label htmlFor="custom-x-coord" className="block text-xs font-semibold text-neutral-700 mb-1">
                          X 軸座標 (點 points，距左邊緣)
                        </label>
                        <input
                          id="custom-x-coord"
                          type="number"
                          value={addTextCustomX}
                          onChange={(e) => setAddTextCustomX(e.target.value)}
                          className="w-full px-3 py-1.5 bg-neutral-50 border border-neutral-300 rounded text-sm"
                        />
                      </div>
                      <div>
                        <label htmlFor="custom-y-coord" className="block text-xs font-semibold text-neutral-700 mb-1">
                          Y 軸座標 (點 points，距底邊緣)
                        </label>
                        <input
                          id="custom-y-coord"
                          type="number"
                          value={addTextCustomY}
                          onChange={(e) => setAddTextCustomY(e.target.value)}
                          className="w-full px-3 py-1.5 bg-neutral-50 border border-neutral-300 rounded text-sm"
                        />
                      </div>
                    </div>
                  )}

                  {/* Live Preview Sample Box */}
                  <div className="p-3.5 bg-white rounded-xl border border-neutral-200 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                      <span>文字樣式即時預覽 (Live Style Preview)</span>
                      <span>{addTextUnderline ? '底線啟用' : '無底線'}</span>
                    </div>
                    <div className="min-h-12 p-3 bg-neutral-50 rounded-lg border border-neutral-100 flex items-center justify-center text-center overflow-hidden">
                      <span
                        style={{
                          color: addTextColor,
                          textDecoration: addTextUnderline ? 'underline' : 'none',
                          fontSize: `${Math.min(28, Math.max(12, parseInt(addTextFontSize || '16', 10)))}px`,
                          fontWeight: 700,
                          lineHeight: 1.3,
                          textDecorationThickness: '2px',
                        }}
                        className="break-all"
                      >
                        {addTextInput || '文字預覽範例'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Markups List */}
              {activeConfigTab === 'markup' && (
                <div className="space-y-3">
                  <div className="p-3.5 bg-white rounded-lg border border-neutral-200">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold text-neutral-700 flex items-center space-x-1.5">
                        <Highlighter className="w-4 h-4 text-yellow-500" />
                        <span>已加入之原文標記與隱私遮罩 ({markups.length})</span>
                      </h4>
                      {markups.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setMarkups([])}
                          className="text-xs text-red-600 hover:text-red-700 font-medium underline cursor-pointer"
                        >
                          清除所有標記
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-neutral-500 mb-3">
                      💡 提示：您可直接在上方「PDF 頁面可視化編輯器」的工具列點選「🛡️ 馬賽克遮罩」、「⬛ 方形遮罩圖層」、「🖍️ 螢光筆劃線」、「📏 原文劃底線」或「🔲 方框」，接著在 PDF 上按住滑鼠左鍵拖曳，即可快速套用！標記與遮罩皆可隨意拖曳移動位置與調整大小。
                    </p>

                    {markups.length === 0 ? (
                      <div className="py-6 text-center text-xs text-neutral-400 border border-dashed border-neutral-200 rounded-lg">
                        尚未加入任何標記或遮罩，請在上方頁面檢視器中拖曳選取。
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                        {markups.map((m, index) => (
                          <div
                            key={m.id}
                            className="flex items-center justify-between p-2 rounded-md bg-neutral-50 border border-neutral-200 text-xs"
                          >
                            <div className="flex items-center space-x-2">
                              <span
                                className="w-3.5 h-3.5 rounded-sm inline-block border border-neutral-300"
                                style={{ backgroundColor: m.type === 'mosaic' ? '#64748b' : m.color }}
                              />
                              <span className="font-semibold text-neutral-800">
                                #{index + 1}{' '}
                                {m.type === 'highlight'
                                  ? '螢光筆塗色標記'
                                  : m.type === 'underline'
                                  ? '原文劃底線'
                                  : m.type === 'strike'
                                  ? '原文刪除線'
                                  : m.type === 'mosaic'
                                  ? '🛡️ 馬賽克隱私遮罩'
                                  : m.type === 'mask'
                                  ? '⬛ 方形遮罩圖層'
                                  : '原文方框'}
                              </span>
                              <span className="text-neutral-500">
                                第 {m.page} 頁 | 寬度: {Math.round(m.width)}pt × 高度: {Math.round(m.height)}pt
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setMarkups((prev) => prev.filter((x) => x.id !== m.id))}
                              className="text-neutral-400 hover:text-red-600 p-1 cursor-pointer"
                              title="刪除此標記/遮罩"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 3: Pasted Screenshots & Images */}
              {activeConfigTab === 'image' && (
                <div className="space-y-3">
                  <div className="p-3.5 bg-white rounded-lg border border-neutral-200">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold text-neutral-700 flex items-center space-x-1.5">
                        <ImageIcon className="w-4 h-4 text-emerald-600" />
                        <span>已插入之截圖與圖片清單 ({pastedImages.length})</span>
                      </h4>
                      {pastedImages.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setPastedImages([])}
                          className="text-xs text-red-600 hover:text-red-700 font-medium underline"
                        >
                          清除所有圖片
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-neutral-500 mb-3">
                      💡 提示：在頁面上隨時按 <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-300 rounded font-mono text-[11px] text-neutral-700">Ctrl+V</kbd> 或點選下方按鈕，即可貼上螢幕截圖，並可在上方 PDF 畫面中自由拖曳移動與調整縮放大小！
                    </p>

                    <div className="flex items-center space-x-2 mb-3">
                      <label
                        className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md text-xs font-medium border border-neutral-300 flex items-center space-x-1.5 cursor-pointer transition-colors"
                      >
                        <UploadCloud className="w-3.5 h-3.5 text-neutral-600" />
                        <span>上傳截圖/圖片檔案</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = (ev) => {
                                const dataUrl = ev.target?.result as string;
                                if (dataUrl) {
                                  setPastedImages((prev) => [
                                    ...prev,
                                    {
                                      id: `img-${Date.now()}`,
                                      name: file.name || '截圖圖片',
                                      dataUrl,
                                      page: 1,
                                      x: 80,
                                      y: 400,
                                      width: 220,
                                      height: 140,
                                    },
                                  ]);
                                }
                              };
                              reader.readAsDataURL(file);
                            }
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>

                    {pastedImages.length === 0 ? (
                      <div className="py-6 text-center text-xs text-neutral-400 border border-dashed border-neutral-200 rounded-lg">
                        尚未插入任何截圖，可按 Ctrl+V 貼上或點選按鈕上傳。
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-56 overflow-y-auto pr-1">
                        {pastedImages.map((img, index) => (
                          <div
                            key={img.id}
                            className="flex items-center space-x-3 p-2 rounded-md bg-neutral-50 border border-neutral-200"
                          >
                            <img
                              src={img.dataUrl}
                              alt={`截圖 #${index + 1}`}
                              className="w-16 h-12 object-contain bg-white rounded border border-neutral-200 shrink-0"
                            />
                            <div className="min-w-0 flex-1 text-xs">
                              <span className="font-semibold text-neutral-800 block truncate">
                                截圖/圖片 #{index + 1}
                              </span>
                              <span className="text-neutral-500 block">
                                第 {img.page} 頁 | 尺寸: {Math.round(img.width)}×{Math.round(img.height)}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setPastedImages((prev) => prev.filter((x) => x.id !== img.id))}
                              className="text-neutral-400 hover:text-red-600 p-1"
                              title="刪除此截圖"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
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
