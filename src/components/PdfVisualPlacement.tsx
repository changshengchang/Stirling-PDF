import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  MousePointer,
  RotateCcw,
  Highlighter,
  Underline as UnderlineIcon,
  Strikethrough,
  Square,
  Image as ImageIcon,
  ClipboardPaste,
  Trash2,
  Plus,
  Move,
  Upload,
  Check,
  Shield,
  EyeOff,
} from 'lucide-react';
import { TextAnnotationItem, MarkupAnnotationItem, PastedImageItem, MarkupType } from '../types';

// Configure pdf.js worker URL
if (typeof window !== 'undefined' && 'Worker' in window) {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  } catch (e) {
    console.warn('Failed setting workerSrc:', e);
  }
}

export type EditorToolMode = 'text' | 'mosaic' | 'mask' | 'highlight' | 'underline' | 'strike' | 'rectangle' | 'image';

export interface PdfVisualPlacementProps {
  file: File;
  textItems: TextAnnotationItem[];
  activeTextId: string;
  onSelectActiveText: (id: string) => void;
  onUpdateTextPosition: (id: string, x: number, y: number, page: number) => void;
  onUpdateTextItem?: (id: string, updates: Partial<TextAnnotationItem>) => void;
  onAddTextItem: (targetPage?: number) => void;
  onDeleteTextItem: (id: string) => void;
  onPageChange?: (page: number) => void;

  markups: MarkupAnnotationItem[];
  onAddMarkup: (markup: MarkupAnnotationItem) => void;
  onDeleteMarkup: (id: string) => void;
  onUpdateMarkup?: (id: string, updates: Partial<MarkupAnnotationItem>) => void;

  images?: PastedImageItem[];
  pastedImages?: PastedImageItem[];
  onAddImage: (img: PastedImageItem) => void;
  onUpdateImage: (id: string, updates: Partial<PastedImageItem>) => void;
  onDeleteImage: (id: string) => void;

  // Optional legacy props
  text?: string;
  color?: string;
  underline?: boolean;
  fontSize?: number;
  customX?: number;
  customY?: number;
  targetPageStr?: string;
  onPositionSelected?: (x: number, y: number, pageNumber: number) => void;
}

const ANNOTATION_COLORS = [
  { name: '極致深黑', hex: '#000000', desc: '公文正式標記、極致清晰' },
  { name: '鮮明深紅', hex: '#b91c1c', desc: '重點警示、錯誤修正' },
  { name: '尊爵深藍', hex: '#1d4ed8', desc: '商務批註、核定劃線' },
  { name: '沉穩深綠', hex: '#15803d', desc: '正確核可、清晰對比' },
  { name: '深曜濃紫', hex: '#7e22ce', desc: '重要分類、醒目標記' },
  { name: '深焦琥珀', hex: '#c2410c', desc: '加強注意、提醒標記' },
  { name: '高對比褐金', hex: '#b45309', desc: '高對比深黃、清晰劃線' },
  { name: '螢光鮮黃', hex: '#ca8a04', desc: '螢光筆醒目反差' },
];

export const PdfVisualPlacement: React.FC<PdfVisualPlacementProps> = ({
  file,
  textItems,
  activeTextId,
  onSelectActiveText,
  onUpdateTextPosition,
  onUpdateTextItem,
  onAddTextItem,
  onDeleteTextItem,
  onPageChange,
  markups,
  onAddMarkup,
  onDeleteMarkup,
  onUpdateMarkup,
  images: imagesProp = [],
  pastedImages: pastedImagesProp = [],
  onAddImage,
  onUpdateImage,
  onDeleteImage,
  onPositionSelected,
}) => {
  const images = imagesProp.length > 0 ? imagesProp : pastedImagesProp;
  const [numPages, setNumPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scale, setScale] = useState<number>(1.0);
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({ width: 595, height: 842 });

  // Tool mode
  const [toolMode, setToolMode] = useState<EditorToolMode>('text');
  const [markupColor, setMarkupColor] = useState<string>('#000000');
  const [markupThickness, setMarkupThickness] = useState<number>(2);

  // Drawing state for highlight / line / mask / mosaic markups
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  // Dragging state for images or text items
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Dragging & direct editing states for text items
  const [draggingTextId, setDraggingTextId] = useState<string | null>(null);
  const [textDragOffset, setTextDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [pendingTextDrag, setPendingTextDrag] = useState<{
    id: string;
    startX: number;
    startY: number;
    offset: { x: number; y: number };
  } | null>(null);

  // Resizing state for text boxes
  const [resizingTextId, setResizingTextId] = useState<string | null>(null);
  const [textResizeStart, setTextResizeStart] = useState<{
    mouseX: number;
    mouseY: number;
    startWidth: number;
    startHeight: number;
    startFontSize: number;
    mode: 'corner' | 'width' | 'height';
  } | null>(null);

  // Dragging & resizing states for markups (Masks, Mosaic, Rectangles)
  const [draggingMarkupId, setDraggingMarkupId] = useState<string | null>(null);
  const [markupDragOffset, setMarkupDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [resizingMarkupId, setResizingMarkupId] = useState<string | null>(null);
  const [markupResizeStart, setMarkupResizeStart] = useState<{
    mouseX: number;
    mouseY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  // Resizing state for images
  const [resizingImageId, setResizingImageId] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState<{ mouseX: number; mouseY: number; startWidth: number; startHeight: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Ensure the view resets to the top of the PDF whenever page or file changes so header is immediately visible
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [currentPage, file]);

  // Load PDF Document
  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setLoadError(null);

    const loadPdf = async () => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(arrayBuffer),
          cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
          cMapPacked: true,
        });

        const doc = await loadingTask.promise;
        if (isCancelled) return;

        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setCurrentPage(1);
        onPageChange?.(1);
        setIsLoading(false);
      } catch (err: any) {
        if (isCancelled) return;
        console.error('Error loading PDF for preview:', err);
        setLoadError(err.message || '無法解析 PDF 文件頁面');
        setIsLoading(false);
      }
    };

    loadPdf();

    return () => {
      isCancelled = true;
    };
  }, [file, onPageChange]);

  const handlePageChange = useCallback(
    (newPage: number) => {
      const clamped = Math.max(1, Math.min(numPages, newPage));
      setCurrentPage(clamped);
      onPageChange?.(clamped);
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
      }
    },
    [numPages, onPageChange]
  );

  // Render current page to canvas
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let renderTask: any = null;
    let isCancelled = false;

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (isCancelled) return;

        const unscaledViewport = page.getViewport({ scale: 1.0 });
        setPageSize({ width: unscaledViewport.width, height: unscaledViewport.height });

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = viewport.width * pixelRatio;
        canvas.height = viewport.height * pixelRatio;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        renderTask = page.render(renderContext);
        await renderTask.promise;

        // Ensure top of document is fully visible
        if (!isCancelled && containerRef.current) {
          containerRef.current.scrollTop = 0;
        }
      } catch (err: any) {
        if (!isCancelled && err?.name !== 'RenderingCancelledException') {
          console.warn('Canvas render error:', err);
        }
      }
    };

    renderPage();

    return () => {
      isCancelled = true;
      if (renderTask && renderTask.cancel) {
        renderTask.cancel();
      }
    };
  }, [pdfDoc, currentPage, scale]);

  // Helper: Convert screen canvas coordinates (pixels from top-left) to PDF points (origin at bottom-left)
  const screenToPdfCoords = useCallback(
    (pixelX: number, pixelY: number) => {
      const pointX = Math.round((pixelX / (pageSize.width * scale)) * pageSize.width);
      const pointY = Math.round(((pageSize.height * scale - pixelY) / (pageSize.height * scale)) * pageSize.height);
      return { x: pointX, y: pointY };
    },
    [pageSize, scale]
  );

  // Helper: Convert PDF coordinates (points from left, bottom) to screen canvas pixels (from top-left)
  const pdfToScreenCoords = useCallback(
    (pdfX: number, pdfY: number) => {
      const pixelX = (pdfX / pageSize.width) * (pageSize.width * scale);
      const pixelY = ((pageSize.height - pdfY) / pageSize.height) * (pageSize.height * scale);
      return { x: pixelX, y: pixelY };
    },
    [pageSize, scale]
  );

  // Process and insert image from file/blob (converts to clean standard PNG dataURL)
  const handleInsertImageBlob = useCallback(
    (blob: Blob, name: string = '截圖') => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const src = e.target?.result as string;
        if (!src) return;

        const img = new Image();
        img.onload = () => {
          // Draw to offscreen canvas to guarantee clean PNG dataUrl
          const offscreenCanvas = document.createElement('canvas');
          offscreenCanvas.width = img.naturalWidth;
          offscreenCanvas.height = img.naturalHeight;
          const ctx = offscreenCanvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(img, 0, 0);
          const pngDataUrl = offscreenCanvas.toDataURL('image/png');

          // Calculate reasonable initial PDF display width (e.g. 200 pt max, preserving aspect ratio)
          const aspectRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
          let initialWidth = Math.min(220, pageSize.width * 0.45);
          let initialHeight = initialWidth / aspectRatio;

          // Place in upper half or center of page
          const initialX = Math.max(20, Math.round((pageSize.width - initialWidth) / 2));
          const initialY = Math.max(20, Math.round((pageSize.height - initialHeight) / 2));

          const newImageItem: PastedImageItem = {
            id: `img-${Date.now()}`,
            name,
            dataUrl: pngDataUrl,
            page: currentPage,
            x: initialX,
            y: initialY,
            width: Math.round(initialWidth),
            height: Math.round(initialHeight),
          };

          onAddImage(newImageItem);
          setToolMode('image');
        };
        img.src = src;
      };
      reader.readAsDataURL(blob);
    },
    [currentPage, pageSize, onAddImage]
  );

  // Global paste handler (Ctrl+V / Cmd+V anywhere on window)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const blob = items[i].getAsFile();
          if (blob) {
            e.preventDefault();
            handleInsertImageBlob(blob, `截圖貼上_${new Date().toLocaleTimeString()}`);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [handleInsertImageBlob]);

  // Read clipboard via Clipboard API button
  const handleClipboardButton = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
          for (const type of item.types) {
            if (type.startsWith('image/')) {
              const blob = await item.getType(type);
              handleInsertImageBlob(blob, '剪貼簿截圖');
              return;
            }
          }
        }
      }
    } catch (err) {
      console.warn('Clipboard read error or permission denied, asking file picker:', err);
    }
    // Fallback to file picker
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Text Box Drag Start Handler: allows dragging from header, frame, or inside textarea
  const handleStartDragText = (
    e: React.MouseEvent,
    itemId: string,
    itemX: number,
    itemY: number,
    isFromTextarea: boolean = false
  ) => {
    e.stopPropagation();
    onSelectActiveText(itemId);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pixelX = e.clientX - rect.left;
    const pixelY = e.clientY - rect.top;
    const { x: pdfX, y: pdfY } = screenToPdfCoords(pixelX, pixelY);
    const offset = { x: pdfX - itemX, y: pdfY - itemY };
    setTextDragOffset(offset);

    if (isFromTextarea) {
      setPendingTextDrag({
        id: itemId,
        startX: e.clientX,
        startY: e.clientY,
        offset,
      });
    } else {
      setDraggingTextId(itemId);
    }
  };

  // Text Box Resize Start Handler
  const handleStartResizeText = (
    e: React.MouseEvent,
    item: TextAnnotationItem,
    mode: 'corner' | 'width' | 'height'
  ) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectActiveText(item.id);
    setResizingTextId(item.id);
    const initialWidth = item.width || Math.max(120, Math.min(450, Math.round(Math.max(6, item.text.length) * item.fontSize * 0.65)));
    const initialHeight = item.height || Math.max(30, Math.round((item.text.split('\n').length || 1) * item.fontSize * 1.3));
    setTextResizeStart({
      mouseX: e.clientX,
      mouseY: e.clientY,
      startWidth: initialWidth,
      startHeight: initialHeight,
      startFontSize: item.fontSize,
      mode,
    });
  };

  // Complete / finalize text editing and exit active state
  const handleCompleteTextEdit = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setEditingTextId(null);
    onSelectActiveText('');
  };

  // Window-level mouse event listeners for ultra-smooth drag tracking (no dropped items)
  useEffect(() => {
    if (!draggingTextId && !pendingTextDrag && !draggingItemId && !resizingImageId && !resizingTextId && !draggingMarkupId && !resizingMarkupId) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const pixelX = e.clientX - rect.left;
      const pixelY = e.clientY - rect.top;

      if (pendingTextDrag) {
        const dist = Math.hypot(e.clientX - pendingTextDrag.startX, e.clientY - pendingTextDrag.startY);
        if (dist > 3) {
          setDraggingTextId(pendingTextDrag.id);
          setTextDragOffset(pendingTextDrag.offset);
          setPendingTextDrag(null);
        }
      }

      if (draggingTextId) {
        const { x: pdfX, y: pdfY } = screenToPdfCoords(pixelX, pixelY);
        const newX = Math.max(0, Math.min(pageSize.width - 10, Math.round(pdfX - textDragOffset.x)));
        const newY = Math.max(0, Math.min(pageSize.height - 10, Math.round(pdfY - textDragOffset.y)));
        onUpdateTextPosition(draggingTextId, newX, newY, currentPage);
      } else if (resizingTextId && textResizeStart) {
        const deltaX = (e.clientX - textResizeStart.mouseX) / scale;
        const deltaY = (e.clientY - textResizeStart.mouseY) / scale;
        const targetItem = textItems.find((t) => t.id === resizingTextId);
        if (targetItem) {
          const newWidth = Math.max(50, Math.min(pageSize.width - targetItem.x, Math.round(textResizeStart.startWidth + deltaX)));
          if (textResizeStart.mode === 'corner') {
            const ratio = Math.max(0.35, newWidth / Math.max(30, textResizeStart.startWidth));
            const newFontSize = Math.max(8, Math.min(72, Math.round(textResizeStart.startFontSize * ratio)));
            const newHeight = Math.max(24, Math.round(textResizeStart.startHeight + deltaY));
            onUpdateTextItem?.(resizingTextId, { width: newWidth, height: newHeight, fontSize: newFontSize });
          } else if (textResizeStart.mode === 'width') {
            onUpdateTextItem?.(resizingTextId, { width: newWidth });
          } else if (textResizeStart.mode === 'height') {
            const newHeight = Math.max(24, Math.round(textResizeStart.startHeight + deltaY));
            onUpdateTextItem?.(resizingTextId, { height: newHeight });
          }
        }
      } else if (draggingMarkupId) {
        const { x: pdfX, y: pdfY } = screenToPdfCoords(pixelX, pixelY);
        const newX = Math.round(pdfX - markupDragOffset.x);
        const newY = Math.round(pdfY - markupDragOffset.y);
        onUpdateMarkup?.(draggingMarkupId, { x: newX, y: newY, page: currentPage });
      } else if (resizingMarkupId && markupResizeStart) {
        const deltaX = (e.clientX - markupResizeStart.mouseX) / scale;
        const deltaY = (e.clientY - markupResizeStart.mouseY) / scale;
        const newWidth = Math.max(10, Math.round(markupResizeStart.startWidth + deltaX));
        const newHeight = Math.max(8, Math.round(markupResizeStart.startHeight + deltaY));
        onUpdateMarkup?.(resizingMarkupId, { width: newWidth, height: newHeight });
      } else if (draggingItemId) {
        const { x: pdfX, y: pdfY } = screenToPdfCoords(pixelX, pixelY);
        const newX = Math.round(pdfX - dragOffset.x);
        const newY = Math.round(pdfY - dragOffset.y);
        onUpdateImage(draggingItemId, { x: newX, y: newY, page: currentPage });
      } else if (resizingImageId && resizeStart) {
        const deltaX = (e.clientX - resizeStart.mouseX) / scale;
        const deltaY = (e.clientY - resizeStart.mouseY) / scale;
        const targetImg = images.find((im) => im.id === resizingImageId);
        if (targetImg) {
          const newWidth = Math.max(30, Math.round(resizeStart.startWidth + deltaX));
          const newHeight = Math.max(20, Math.round(resizeStart.startHeight + deltaY));
          onUpdateImage(resizingImageId, { width: newWidth, height: newHeight });
        }
      }
    };

    const handleWindowMouseUp = () => {
      if (pendingTextDrag) setPendingTextDrag(null);
      if (draggingTextId) setDraggingTextId(null);
      if (resizingTextId) {
        setResizingTextId(null);
        setTextResizeStart(null);
      }
      if (draggingMarkupId) setDraggingMarkupId(null);
      if (resizingMarkupId) {
        setResizingMarkupId(null);
        setMarkupResizeStart(null);
      }
      if (draggingItemId) setDraggingItemId(null);
      if (resizingImageId) {
        setResizingImageId(null);
        setResizeStart(null);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [
    pendingTextDrag,
    draggingTextId,
    textDragOffset,
    resizingTextId,
    textResizeStart,
    textItems,
    onUpdateTextItem,
    draggingMarkupId,
    markupDragOffset,
    resizingMarkupId,
    markupResizeStart,
    onUpdateMarkup,
    draggingItemId,
    dragOffset,
    resizingImageId,
    resizeStart,
    scale,
    pageSize,
    currentPage,
    screenToPdfCoords,
    onUpdateTextPosition,
    onUpdateImage,
    images,
  ]);

  // Canvas Mouse Down: handles drawing markups, positioning text, or selecting items
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const pixelX = e.clientX - rect.left;
    const pixelY = e.clientY - rect.top;

    if (pixelX < 0 || pixelX > rect.width || pixelY < 0 || pixelY > rect.height) return;

    // Clicking blank canvas closes in-place editing focus & active text box
    if (activeTextId && !draggingTextId && !resizingTextId) {
      handleCompleteTextEdit();
    }

    if (toolMode === 'text') {
      const { x, y } = screenToPdfCoords(pixelX, pixelY);
      onUpdateTextPosition(activeTextId, x, y, currentPage);
      if (onPositionSelected) {
        onPositionSelected(x, y, currentPage);
      }
      return;
    }

    if (toolMode === 'highlight' || toolMode === 'underline' || toolMode === 'strike' || toolMode === 'rectangle' || toolMode === 'mask' || toolMode === 'mosaic') {
      setIsDrawing(true);
      setDrawStart({ x: pixelX, y: pixelY });
      setDrawCurrent({ x: pixelX, y: pixelY });
    }
  };

  // Canvas Mouse Move: handles draft markup preview, dragging items, or resizing images
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const pixelX = e.clientX - rect.left;
    const pixelY = e.clientY - rect.top;

    // Dragging text item
    if (draggingTextId) {
      const { x: pdfX, y: pdfY } = screenToPdfCoords(pixelX, pixelY);
      const newX = Math.max(0, Math.min(pageSize.width - 10, Math.round(pdfX - textDragOffset.x)));
      const newY = Math.max(0, Math.min(pageSize.height - 10, Math.round(pdfY - textDragOffset.y)));
      onUpdateTextPosition(draggingTextId, newX, newY, currentPage);
      return;
    }

    // Resizing image
    if (resizingImageId && resizeStart) {
      const deltaX = (e.clientX - resizeStart.mouseX) / scale;
      const deltaY = (e.clientY - resizeStart.mouseY) / scale;
      const targetImg = images.find((im) => im.id === resizingImageId);
      if (targetImg) {
        const newWidth = Math.max(30, Math.round(resizeStart.startWidth + deltaX));
        const newHeight = Math.max(20, Math.round(resizeStart.startHeight + deltaY));
        onUpdateImage(resizingImageId, { width: newWidth, height: newHeight });
      }
      return;
    }

    // Dragging image
    if (draggingItemId) {
      const { x: pdfX, y: pdfY } = screenToPdfCoords(pixelX, pixelY);
      const targetImg = images.find((im) => im.id === draggingItemId);
      if (targetImg) {
        const newX = Math.round(pdfX - dragOffset.x);
        const newY = Math.round(pdfY - dragOffset.y);
        onUpdateImage(draggingItemId, { x: newX, y: newY, page: currentPage });
      }
      return;
    }

    // Drawing markup
    if (isDrawing && drawStart) {
      setDrawCurrent({ x: pixelX, y: pixelY });
    }
  };

  // Canvas Mouse Up: finalize markup drawing, dragging, or resizing
  const handleCanvasMouseUp = () => {
    if (draggingTextId) {
      setDraggingTextId(null);
    }

    if (resizingImageId) {
      setResizingImageId(null);
      setResizeStart(null);
    }

    if (draggingItemId) {
      setDraggingItemId(null);
    }

    if (isDrawing && drawStart && drawCurrent) {
      setIsDrawing(false);

      const minX = Math.min(drawStart.x, drawCurrent.x);
      const maxX = Math.max(drawStart.x, drawCurrent.x);
      const minY = Math.min(drawStart.y, drawCurrent.y);
      const maxY = Math.max(drawStart.y, drawCurrent.y);

      // Require a small minimum drag distance
      if (maxX - minX > 5 || maxY - minY > 5) {
        // Convert top-left and bottom-right to PDF points
        const startPdf = screenToPdfCoords(minX, maxY);
        const endPdf = screenToPdfCoords(maxX, minY);

        const pdfWidth = Math.max(4, endPdf.x - startPdf.x);
        const pdfHeight = Math.max(4, endPdf.y - startPdf.y);

        const newMarkup: MarkupAnnotationItem = {
          id: `markup-${Date.now()}`,
          type: toolMode as MarkupType,
          page: currentPage,
          x: startPdf.x,
          y: startPdf.y,
          width: pdfWidth,
          height: pdfHeight,
          color: toolMode === 'mosaic' ? '#64748b' : (toolMode === 'mask' ? (markupColor || '#000000') : markupColor),
          opacity: toolMode === 'highlight' ? 0.35 : (toolMode === 'mask' || toolMode === 'mosaic' ? 1.0 : 0.85),
          strokeWidth: markupThickness,
        };

        onAddMarkup(newMarkup);
      }

      setDrawStart(null);
      setDrawCurrent(null);
    }
  };

  // Filter items for the current page
  const pageTextItems = textItems.filter((t) => t.page === currentPage || t.page.toString().toLowerCase() === 'all');
  const activeTextItem = textItems.find((t) => t.id === activeTextId);
  const pageMarkups = markups.filter((m) => m.page === currentPage);
  const pageImages = images.filter((img) => img.page === currentPage);

  return (
    <div className="bg-white rounded-xl border border-neutral-200 shadow-xs overflow-hidden select-none">
      {/* Hidden File Input for Image Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleInsertImageBlob(e.target.files[0], e.target.files[0].name);
            e.target.value = '';
          }
        }}
      />

      {/* Primary Mode Navigation Bar */}
      <div className="p-2.5 bg-neutral-900 text-white flex flex-wrap items-center justify-between gap-2 text-xs">
        {/* Tool Mode Buttons */}
        <div className="flex items-center space-x-1 overflow-x-auto py-0.5">
          <span className="text-[11px] font-medium text-neutral-400 mr-1 hidden sm:inline">編輯工具：</span>

          <button
            type="button"
            onClick={() => setToolMode('text')}
            className={`px-2.5 py-1.5 rounded-md font-medium flex items-center space-x-1.5 transition-all cursor-pointer ${
              toolMode === 'text' ? 'bg-red-600 text-white shadow-sm' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            <MousePointer className="w-3.5 h-3.5" />
            <span>✍️ 新增文字定位 ({textItems.length} 組)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setToolMode('mosaic');
              setMarkupColor('#64748b');
            }}
            className={`px-2.5 py-1.5 rounded-md font-medium flex items-center space-x-1.5 transition-all cursor-pointer ${
              toolMode === 'mosaic' ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-white/30' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
            title="馬賽克隱私遮罩：框選任何文字立即打上馬賽克保護個資"
          >
            <Shield className="w-3.5 h-3.5 text-indigo-300" />
            <span>🛡️ 馬賽克遮罩 ({markups.filter((m) => m.type === 'mosaic').length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setToolMode('mask');
              setMarkupColor('#000000');
            }}
            className={`px-2.5 py-1.5 rounded-md font-medium flex items-center space-x-1.5 transition-all cursor-pointer ${
              toolMode === 'mask' ? 'bg-neutral-950 text-white shadow-sm ring-1 ring-white/30 border border-neutral-700' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
            title="方形遮罩圖層：100% 不透光遮蔽塗黑或白底遮除"
          >
            <EyeOff className="w-3.5 h-3.5 text-neutral-300" />
            <span>⬛ 方形遮罩圖層 ({markups.filter((m) => m.type === 'mask').length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setToolMode('highlight');
              setMarkupColor('#eab308');
            }}
            className={`px-2.5 py-1.5 rounded-md font-medium flex items-center space-x-1.5 transition-all cursor-pointer ${
              toolMode === 'highlight' ? 'bg-amber-500 text-neutral-950 font-bold shadow-sm' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            <Highlighter className="w-3.5 h-3.5" />
            <span>🖍️ 螢光筆塗色標記</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setToolMode('underline');
              setMarkupColor('#dc2626');
            }}
            className={`px-2.5 py-1.5 rounded-md font-medium flex items-center space-x-1.5 transition-all cursor-pointer ${
              toolMode === 'underline' ? 'bg-red-600 text-white shadow-sm' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            <UnderlineIcon className="w-3.5 h-3.5" />
            <span>📏 原文劃底線</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setToolMode('strike');
              setMarkupColor('#dc2626');
            }}
            className={`px-2.5 py-1.5 rounded-md font-medium flex items-center space-x-1.5 transition-all cursor-pointer ${
              toolMode === 'strike' ? 'bg-rose-600 text-white shadow-sm' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            <Strikethrough className="w-3.5 h-3.5" />
            <span>✂️ 刪除線</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setToolMode('rectangle');
              setMarkupColor('#dc2626');
            }}
            className={`px-2.5 py-1.5 rounded-md font-medium flex items-center space-x-1.5 transition-all cursor-pointer ${
              toolMode === 'rectangle' ? 'bg-purple-600 text-white shadow-sm' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            <Square className="w-3.5 h-3.5" />
            <span>🔲 方框標記</span>
          </button>

          <button
            type="button"
            onClick={() => setToolMode('image')}
            className={`px-2.5 py-1.5 rounded-md font-medium flex items-center space-x-1.5 transition-all cursor-pointer ${
              toolMode === 'image' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>📋 插入截圖/圖片 ({images.length})</span>
          </button>
        </div>

        {/* Page Nav & Zoom */}
        <div className="flex items-center space-x-2">
          {/* Page navigator */}
          <div className="flex items-center bg-neutral-800 border border-neutral-700 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1 || isLoading}
              className="p-1 text-neutral-300 hover:text-white disabled:opacity-30 cursor-pointer"
              title="上一頁"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 text-[11px] font-mono font-medium text-neutral-200 select-none">
              {currentPage} / {numPages}
            </span>
            <button
              type="button"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= numPages || isLoading}
              className="p-1 text-neutral-300 hover:text-white disabled:opacity-30 cursor-pointer"
              title="下一頁"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center bg-neutral-800 border border-neutral-700 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.6, Math.round((s - 0.15) * 100) / 100))}
              disabled={scale <= 0.6 || isLoading}
              className="p-1 text-neutral-300 hover:text-white disabled:opacity-30 cursor-pointer"
              title="縮小"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="px-1 text-[11px] font-mono text-neutral-300 select-none">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(2.0, Math.round((s + 0.15) * 100) / 100))}
              disabled={scale >= 2.0 || isLoading}
              className="p-1 text-neutral-300 hover:text-white disabled:opacity-30 cursor-pointer"
              title="放大"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setScale(1.0)}
              className="p-1 text-neutral-400 hover:text-white cursor-pointer ml-0.5"
              title="重設 100%"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Secondary Context Action Sub-Bar */}
      <div className="px-3 py-2 bg-neutral-50 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Context-sensitive controls */}
        {toolMode === 'text' && (
          <div className="flex items-center flex-wrap gap-2">
            <span className="font-semibold text-neutral-700">選擇要定位的文字組：</span>
            <div className="flex items-center space-x-1.5 overflow-x-auto max-w-md py-0.5">
              {textItems.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === activeTextId) {
                      handleCompleteTextEdit();
                    } else {
                      onSelectActiveText(item.id);
                      setEditingTextId(item.id);
                      const targetPage = typeof item.page === 'number' ? item.page : parseInt((item as any).page, 10);
                      if (!isNaN(targetPage) && targetPage >= 1 && targetPage !== currentPage) {
                        handlePageChange(targetPage);
                      }
                    }
                  }}
                  className={`px-2 py-1 rounded-md text-xs font-medium flex items-center space-x-1 transition-all cursor-pointer ${
                    item.id === activeTextId
                      ? 'bg-blue-600 text-white shadow-xs font-semibold'
                      : 'bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                  }`}
                  title={item.id === activeTextId ? '點擊完成確定' : `點擊選取編輯（位於第 ${item.page || 1} 頁）`}
                >
                  <span>文字 #{idx + 1}</span>
                  <span className="text-[10px] font-mono opacity-80">(P.{item.page || 1})</span>
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block border border-white ml-0.5"
                    style={{ backgroundColor: item.color }}
                  />
                  {item.id === activeTextId && <Check className="w-3 h-3 ml-0.5" />}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onAddTextItem(currentPage)}
                className="px-2.5 py-1 bg-neutral-900 hover:bg-black text-white rounded-md font-semibold text-xs flex items-center space-x-1 cursor-pointer shadow-xs"
                title={`在目前頁數 (第 ${currentPage} 頁) 新增文字方塊`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新增文字 (第 {currentPage} 頁)</span>
              </button>
              {activeTextId && (
                <button
                  type="button"
                  onClick={handleCompleteTextEdit}
                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md font-bold text-xs flex items-center space-x-1 cursor-pointer shadow-xs"
                  title="完成所有文字輸入確認"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>完成確認</span>
                </button>
              )}
            </div>

            {activeTextItem && onUpdateTextItem && (
              <div className="flex items-center space-x-1.5 bg-white px-2 py-1 rounded-md border border-neutral-200">
                <span className="font-semibold text-neutral-800 text-xs">文字顏色：</span>
                {ANNOTATION_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => {
                      onUpdateTextItem(activeTextId, { color: c.hex });
                    }}
                    title={`${c.name} (${c.desc})`}
                    className={`w-4.5 h-4.5 rounded-full border transition-transform cursor-pointer ${
                      (activeTextItem.color || '#dc2626').toLowerCase() === c.hex.toLowerCase()
                        ? 'scale-125 ring-2 ring-neutral-900 border-white shadow-xs'
                        : 'border-neutral-300 hover:scale-110'
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
                <label
                  className="flex items-center space-x-1 cursor-pointer text-xs text-neutral-700 bg-neutral-50 border border-neutral-300 rounded px-1.5 py-0.5 hover:bg-neutral-100 ml-0.5"
                  title="自訂文字顏色"
                >
                  <span className="text-[11px] font-medium">自訂：</span>
                  <input
                    type="color"
                    value={activeTextItem.color || '#dc2626'}
                    onChange={(e) => {
                      onUpdateTextItem(activeTextId, { color: e.target.value });
                    }}
                    className="w-4 h-4 rounded cursor-pointer border-0 p-0"
                  />
                </label>
              </div>
            )}

            <span className="text-[11px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-medium">
              💡 提示：按住文字頂部可「拖曳移動」，拖曳右側或右下角可「調整方塊大小」，點擊「完成」即可確認固定！
            </span>
          </div>
        )}

        {toolMode === 'mosaic' && (
          <div className="flex items-center flex-wrap gap-3">
            <div className="flex items-center space-x-1.5">
              <span className="font-semibold text-neutral-800">🛡️ 馬賽克隱私遮罩：</span>
              <span className="text-neutral-600 text-xs">
                在 PDF 畫面上「滑鼠按住拖曳」框選任何文字或個資，立即打上馬賽克保護隱私！
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                const newMarkup: MarkupAnnotationItem = {
                  id: `markup-${Date.now()}`,
                  type: 'mosaic',
                  page: currentPage,
                  x: Math.round(pageSize.width / 2 - 60),
                  y: Math.round(pageSize.height / 2 - 12),
                  width: 120,
                  height: 24,
                  color: '#64748b',
                  opacity: 1.0,
                  strokeWidth: 1,
                };
                onAddMarkup(newMarkup);
              }}
              className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-md flex items-center space-x-1 cursor-pointer shadow-xs active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>＋ 在本頁中央新增馬賽克遮罩</span>
            </button>
            <span className="text-neutral-500 text-[11px]">
              （提示：產生的馬賽克遮罩可按住隨意拖曳，拖曳右下角可放大縮小）
            </span>
          </div>
        )}

        {toolMode === 'mask' && (
          <div className="flex items-center flex-wrap gap-3">
            <div className="flex items-center space-x-1.5">
              <span className="font-semibold text-neutral-800">⬛ 方形遮罩圖層：</span>
              {[
                { name: '⬛ 純黑塗黑 (Blackout)', hex: '#000000' },
                { name: '⬜ 純白遮除 (Whiteout)', hex: '#ffffff' },
                { name: '🔘 灰色隱私條', hex: '#64748b' },
              ].map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setMarkupColor(c.hex)}
                  className={`px-2 py-0.5 rounded text-xs font-medium border flex items-center space-x-1 cursor-pointer transition-colors ${
                    markupColor === c.hex ? 'bg-neutral-900 text-white border-neutral-900 shadow-xs' : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-100'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full inline-block border border-neutral-400" style={{ backgroundColor: c.hex }} />
                  <span>{c.name}</span>
                </button>
              ))}
              <label className="cursor-pointer flex items-center text-xs text-neutral-600 space-x-1 ml-1" title="自訂遮罩顏色">
                <span>自訂：</span>
                <input
                  type="color"
                  value={markupColor}
                  onChange={(e) => setMarkupColor(e.target.value)}
                  className="w-5 h-5 rounded border border-neutral-300 p-0 cursor-pointer"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => {
                const newMarkup: MarkupAnnotationItem = {
                  id: `markup-${Date.now()}`,
                  type: 'mask',
                  page: currentPage,
                  x: Math.round(pageSize.width / 2 - 60),
                  y: Math.round(pageSize.height / 2 - 12),
                  width: 120,
                  height: 24,
                  color: markupColor || '#000000',
                  opacity: 1.0,
                  strokeWidth: 1,
                };
                onAddMarkup(newMarkup);
              }}
              className="px-2.5 py-1 bg-neutral-900 hover:bg-black text-white text-xs font-semibold rounded-md flex items-center space-x-1 cursor-pointer shadow-xs active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>＋ 在本頁中央新增方形遮罩</span>
            </button>
            <span className="text-neutral-500 text-[11px]">
              👉 拖曳框選文字即可產生 100% 不透光遮罩圖層，顧及隱私
            </span>
          </div>
        )}

        {(toolMode === 'highlight' || toolMode === 'underline' || toolMode === 'strike' || toolMode === 'rectangle') && (
          <div className="flex items-center flex-wrap gap-3">
            <div className="flex items-center space-x-1.5">
              <span className="font-semibold text-neutral-800">標記顏色（深色鮮明）：</span>
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setMarkupColor(c.hex)}
                  title={`${c.name} (${c.desc})`}
                  className={`w-5 h-5 rounded-full border transition-transform cursor-pointer ${
                    markupColor.toLowerCase() === c.hex.toLowerCase()
                      ? 'scale-125 ring-2 ring-neutral-900 border-white shadow-xs'
                      : 'border-neutral-300 hover:scale-110 opacity-95'
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
              <label
                className="flex items-center space-x-1 cursor-pointer text-xs text-neutral-700 bg-white border border-neutral-300 rounded px-1.5 py-0.5 hover:bg-neutral-100 ml-1"
                title="點選自訂任意深色或特殊顏色"
              >
                <span className="text-[11px] font-medium">自訂：</span>
                <input
                  type="color"
                  value={markupColor}
                  onChange={(e) => setMarkupColor(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border-0 p-0"
                />
              </label>
            </div>

            <div className="flex items-center space-x-1.5">
              <span className="text-neutral-600">線條粗細：</span>
              {[1, 2, 3, 5].map((thickness) => (
                <button
                  key={thickness}
                  type="button"
                  onClick={() => setMarkupThickness(thickness)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer ${
                    markupThickness === thickness ? 'bg-neutral-800 text-white font-bold' : 'bg-white border border-neutral-300 text-neutral-700'
                  }`}
                >
                  {thickness}px
                </button>
              ))}
            </div>

            <span className="text-neutral-500 text-[11px]">
              👉 於 PDF 畫面上「滑鼠按住拖曳」即可完成原文劃線或螢光筆塗色標記
            </span>
          </div>
        )}

        {toolMode === 'image' && (
          <div className="flex items-center flex-wrap gap-2">
            <button
              type="button"
              onClick={handleClipboardButton}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-md flex items-center space-x-1.5 shadow-xs cursor-pointer"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              <span>貼上剪貼簿截圖 (Ctrl+V)</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1 bg-white hover:bg-neutral-100 border border-neutral-300 text-neutral-700 font-medium rounded-md flex items-center space-x-1.5 shadow-2xs cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>選擇截圖/圖片檔案</span>
            </button>

            <span className="text-neutral-500 text-[11px]">
              （支援在任一處直接按 Ctrl+V 貼上螢幕截圖，並可在畫面上任意拖曳與縮放尺寸）
            </span>
          </div>
        )}
      </div>

      {/* Main Interactive Canvas Viewer Area */}
      <div
        ref={containerRef}
        className="relative w-full overflow-auto bg-neutral-900/95 pt-8 pb-16 px-6 flex items-start justify-center min-h-[480px] max-h-[800px] scroll-smooth"
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
      >
        {isLoading && (
          <div className="flex flex-col items-center space-y-2 text-white/80">
            <div className="w-8 h-8 border-3 border-white/20 border-t-white rounded-full animate-spin" />
            <span className="text-xs">正在渲染 PDF 原始畫面...</span>
          </div>
        )}

        {loadError && (
          <div className="p-4 bg-red-950/80 border border-red-500/50 rounded-xl text-red-200 text-xs text-center max-w-md">
            <p className="font-semibold mb-1">無法在畫面中渲染此 PDF</p>
            <p className="text-red-300">{loadError}</p>
          </div>
        )}

        {/* The PDF Canvas and Position Overlay */}
        <div
          onMouseDown={handleCanvasMouseDown}
          className={`relative bg-white shadow-2xl transition-shadow select-none mt-2 mb-12 mx-auto ${
            isLoading ? 'hidden' : 'block'
          } ${toolMode === 'text' ? 'cursor-crosshair' : toolMode === 'image' ? 'cursor-default' : 'cursor-crosshair'}`}
          style={{
            maxWidth: '100%',
          }}
        >
          <canvas ref={canvasRef} className="block pointer-events-none" />

          {/* 1. Render All Existing Markups for Current Page */}
          {!isLoading &&
            pageMarkups.map((m) => {
              const { x: leftPx, y: topPx } = pdfToScreenCoords(m.x, m.y + m.height);
              const widthPx = (m.width / pageSize.width) * (pageSize.width * scale);
              const heightPx = (m.height / pageSize.height) * (pageSize.height * scale);

              return (
                <div
                  key={m.id}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    const canvas = canvasRef.current;
                    if (!canvas) return;
                    const rect = canvas.getBoundingClientRect();
                    const pixelX = e.clientX - rect.left;
                    const pixelY = e.clientY - rect.top;
                    const { x: pdfX, y: pdfY } = screenToPdfCoords(pixelX, pixelY);
                    setDraggingMarkupId(m.id);
                    setMarkupDragOffset({ x: pdfX - m.x, y: pdfY - m.y });
                  }}
                  className="absolute group z-20 transition-opacity cursor-move select-none"
                  style={{
                    left: `${leftPx}px`,
                    top: `${topPx}px`,
                    width: `${widthPx}px`,
                    height: `${heightPx}px`,
                  }}
                  title="可拖曳移動此標記/遮罩，右下角可縮放大小"
                >
                  {/* Visual Representation */}
                  {m.type === 'highlight' && (
                    <div
                      className="w-full h-full rounded-xs pointer-events-none"
                      style={{
                        backgroundColor: m.color,
                        opacity: m.opacity || 0.35,
                        mixBlendMode: 'multiply',
                      }}
                    />
                  )}

                  {m.type === 'underline' && (
                    <div
                      className="absolute bottom-0 left-0 w-full pointer-events-none"
                      style={{
                        borderBottom: `${m.strokeWidth || 2}px solid ${m.color}`,
                        opacity: m.opacity || 0.9,
                      }}
                    />
                  )}

                  {m.type === 'strike' && (
                    <div
                      className="absolute top-1/2 left-0 w-full pointer-events-none"
                      style={{
                        borderBottom: `${m.strokeWidth || 2}px solid ${m.color}`,
                        opacity: m.opacity || 0.9,
                      }}
                    />
                  )}

                  {m.type === 'rectangle' && (
                    <div
                      className="w-full h-full rounded-xs pointer-events-none"
                      style={{
                        border: `${m.strokeWidth || 2}px solid ${m.color}`,
                        opacity: m.opacity || 0.9,
                      }}
                    />
                  )}

                  {m.type === 'mask' && (
                    <div
                      className="w-full h-full rounded-xs pointer-events-none shadow-xs flex items-center justify-center overflow-hidden"
                      style={{
                        backgroundColor: m.color || '#000000',
                        opacity: m.opacity !== undefined ? m.opacity : 1.0,
                        border: m.color === '#ffffff' ? '1px dashed #94a3b8' : '1px solid rgba(0,0,0,0.15)',
                      }}
                    >
                      {m.color === '#ffffff' && (
                        <span className="text-[9px] text-neutral-400 select-none font-mono opacity-80 px-1 bg-white/80 rounded">
                          白底遮罩
                        </span>
                      )}
                      {m.color === '#000000' && (
                        <span className="text-[9px] text-neutral-400 select-none font-mono tracking-wider opacity-40">
                          REDACTED
                        </span>
                      )}
                    </div>
                  )}

                  {m.type === 'mosaic' && (
                    <div
                      className="w-full h-full rounded-xs pointer-events-none shadow-xs relative overflow-hidden"
                      style={{
                        backgroundImage: `
                          linear-gradient(45deg, #94a3b8 25%, transparent 25%),
                          linear-gradient(-45deg, #94a3b8 25%, transparent 25%),
                          linear-gradient(45deg, transparent 75%, #94a3b8 75%),
                          linear-gradient(-45deg, transparent 75%, #94a3b8 75%)
                        `,
                        backgroundSize: '8px 8px',
                        backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
                        backgroundColor: '#cbd5e1',
                        border: '1px solid #64748b',
                        opacity: 0.98,
                      }}
                    >
                      <div className="absolute inset-0 bg-neutral-900/10 backdrop-blur-[1px]" />
                      <span className="absolute bottom-0.5 right-1 text-[8px] font-bold text-neutral-700 bg-white/85 px-1 rounded shadow-2xs">
                        馬賽克
                      </span>
                    </div>
                  )}

                  {/* Corner Resize Handle for Mask, Mosaic, Rectangle */}
                  {(m.type === 'mask' || m.type === 'mosaic' || m.type === 'rectangle') && (
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setResizingMarkupId(m.id);
                        setMarkupResizeStart({
                          mouseX: e.clientX,
                          mouseY: e.clientY,
                          startWidth: m.width,
                          startHeight: m.height,
                        });
                      }}
                      className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-blue-600 border border-white rounded-full cursor-nwse-resize opacity-0 group-hover:opacity-100 shadow-md z-30 transition-opacity"
                      title="拖曳調整大小"
                    />
                  )}

                  {/* Hover Delete Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteMarkup(m.id);
                    }}
                    title="刪除此標記/遮罩"
                    className="absolute -top-3 -right-3 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-md cursor-pointer transition-opacity z-30"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}

          {/* 2. Draft Dragging Markup Preview */}
          {isDrawing && drawStart && drawCurrent && (
            <div
              className="absolute pointer-events-none z-20 border border-dashed rounded-xs overflow-hidden"
              style={{
                left: `${Math.min(drawStart.x, drawCurrent.x)}px`,
                top: `${Math.min(drawStart.y, drawCurrent.y)}px`,
                width: `${Math.abs(drawCurrent.x - drawStart.x)}px`,
                height: `${Math.abs(drawCurrent.y - drawStart.y)}px`,
                borderColor: toolMode === 'mosaic' ? '#64748b' : markupColor,
                backgroundColor:
                  toolMode === 'highlight'
                    ? markupColor
                    : toolMode === 'mask'
                    ? markupColor || '#000000'
                    : toolMode === 'mosaic'
                    ? '#94a3b8'
                    : 'transparent',
                opacity: toolMode === 'highlight' ? 0.35 : 0.9,
              }}
            >
              {toolMode === 'mosaic' && (
                <div className="w-full h-full flex items-center justify-center text-[10px] text-white font-bold bg-neutral-700/60">
                  🛡️ 馬賽克遮罩中...
                </div>
              )}
              {toolMode === 'mask' && (
                <div className="w-full h-full flex items-center justify-center text-[10px] text-neutral-400 font-bold">
                  ⬛ 隱私遮罩
                </div>
              )}
            </div>
          )}

          {/* 3. Render All Pasted Images / Screenshots on Current Page */}
          {!isLoading &&
            pageImages.map((img) => {
              const { x: leftPx, y: topPx } = pdfToScreenCoords(img.x, img.y + img.height);
              const widthPx = (img.width / pageSize.width) * (pageSize.width * scale);
              const heightPx = (img.height / pageSize.height) * (pageSize.height * scale);

              return (
                <div
                  key={img.id}
                  className="absolute group z-20 border border-emerald-500/70 hover:border-emerald-600 shadow-lg rounded-xs"
                  style={{
                    left: `${leftPx}px`,
                    top: `${topPx}px`,
                    width: `${widthPx}px`,
                    height: `${heightPx}px`,
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setDraggingItemId(img.id);
                    const { x: pdfX, y: pdfY } = screenToPdfCoords(
                      e.clientX - canvasRef.current!.getBoundingClientRect().left,
                      e.clientY - canvasRef.current!.getBoundingClientRect().top
                    );
                    setDragOffset({ x: pdfX - img.x, y: pdfY - img.y });
                  }}
                >
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="w-full h-full object-fill pointer-events-none rounded-xs select-none"
                    draggable={false}
                  />

                  {/* Move Handle Badge */}
                  <div className="absolute top-1 left-1 bg-emerald-700/90 text-white text-[9px] px-1.5 py-0.5 rounded font-mono flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-move pointer-events-none">
                    <Move className="w-2.5 h-2.5" />
                    <span>拖曳移動</span>
                  </div>

                  {/* Delete Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteImage(img.id);
                    }}
                    title="刪除此截圖"
                    className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center shadow-md cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity z-30"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>

                  {/* Resize Handle (bottom-right corner) */}
                  <div
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setResizingImageId(img.id);
                      setResizeStart({
                        mouseX: e.clientX,
                        mouseY: e.clientY,
                        startWidth: img.width,
                        startHeight: img.height,
                      });
                    }}
                    className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-emerald-600 border border-white rounded-full cursor-nwse-resize shadow-md flex items-center justify-center opacity-80 hover:opacity-100"
                    title="拖曳縮放截圖大小"
                  />
                </div>
              );
            })}

          {/* 4. Render All Text Annotation Items on Current Page */}
          {!isLoading &&
            pageTextItems.map((item, idx) => {
              const { x: leftPx, y: topPx } = pdfToScreenCoords(item.x, item.y);
              const isActive = item.id === activeTextId;
              const isBeingDragged = draggingTextId === item.id;

              // If NOT active: render in confirmed finalized state (no blue borders, no toolbar, pure text)
              if (!isActive) {
                return (
                  <div
                    key={item.id}
                    onMouseDown={(e) => handleStartDragText(e, item.id, item.x, item.y, false)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectActiveText(item.id);
                      setEditingTextId(item.id);
                    }}
                    className="absolute group select-none cursor-move transition-all z-20"
                    style={{
                      left: `${leftPx}px`,
                      top: `${topPx}px`,
                      transform: 'translate(0, -100%)',
                      width: item.width ? `${item.width * scale}px` : undefined,
                    }}
                    title="按住方框可隨意拖曳移動，點擊可重新編輯文字"
                  >
                    <div
                      className="p-1 rounded transition-all border border-transparent group-hover:border-blue-400 group-hover:bg-blue-50/25 group-hover:shadow-xs"
                      style={{
                        color: item.color,
                        textDecoration: item.underline ? 'underline' : 'none',
                        fontSize: `${Math.max(10, item.fontSize * scale)}px`,
                        fontWeight: 700,
                        lineHeight: 1.25,
                        textDecorationThickness: '2px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        minWidth: '30px',
                      }}
                    >
                      {item.text || <span className="text-neutral-400 italic font-normal">（點擊輸入文字）</span>}
                    </div>
                  </div>
                );
              }

              // If ACTIVE: render full toolbar, drag handle, textarea, and resize handles
              const isNearTop = topPx < 48;
              return (
                <div
                  key={item.id}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute flex flex-col items-start select-none transition-shadow z-40"
                  style={{
                    left: `${leftPx}px`,
                    top: `${topPx}px`,
                    transform: isNearTop ? 'none' : 'translate(0, -100%)',
                  }}
                >
                  {/* Floating Mini Formatting Toolbar (only shown when selected & editing, hidden while dragging to keep view clean) */}
                  {!isBeingDragged && (
                    <div
                      onMouseDown={(e) => e.stopPropagation()}
                      className={`${
                        isNearTop ? 'order-last mt-1.5' : 'order-first mb-1'
                      } bg-neutral-900 text-white px-2 py-1 rounded-lg shadow-xl flex items-center space-x-2 text-xs animate-in fade-in zoom-in-95 duration-100`}
                    >
                      {/* 1. Done editing checkmark (Keep the top one as requested) */}
                      <button
                        type="button"
                        onClick={(e) => handleCompleteTextEdit(e)}
                        className="px-2.5 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-bold flex items-center space-x-1 cursor-pointer shadow-xs active:scale-95 transition-transform ring-1 ring-white/20"
                        title="完成輸入確定狀態"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>完成</span>
                      </button>

                      <div className="w-[1px] h-3.5 bg-neutral-700" />

                      {/* Dark, prominent, high-contrast color dots */}
                      <div className="flex items-center space-x-1">
                        {['#000000', '#b91c1c', '#1d4ed8', '#15803d', '#7e22ce', '#c2410c', '#b45309'].map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => onUpdateTextItem?.(item.id, { color: c })}
                            className={`w-3.5 h-3.5 rounded-full border transition-transform cursor-pointer ${
                              item.color === c ? 'scale-125 border-white ring-1 ring-white' : 'border-neutral-600 hover:scale-110'
                            }`}
                            style={{ backgroundColor: c }}
                            title={`變更顏色為 ${c}`}
                          />
                        ))}
                        <label className="cursor-pointer flex items-center" title="自訂顏色">
                          <input
                            type="color"
                            value={item.color}
                            onChange={(e) => onUpdateTextItem?.(item.id, { color: e.target.value })}
                            className="w-4 h-4 rounded border-0 p-0 cursor-pointer bg-transparent"
                          />
                        </label>
                      </div>

                      <div className="w-[1px] h-3.5 bg-neutral-700" />

                      {/* Font size -/+ */}
                      <div className="flex items-center space-x-1">
                        <button
                          type="button"
                          onClick={() => onUpdateTextItem?.(item.id, { fontSize: Math.max(8, item.fontSize - 2) })}
                          className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px] font-bold cursor-pointer"
                          title="縮小字體"
                        >
                          A-
                        </button>
                        <span className="text-[10px] font-mono w-6 text-center text-neutral-300">
                          {item.fontSize}
                        </span>
                        <button
                          type="button"
                          onClick={() => onUpdateTextItem?.(item.id, { fontSize: Math.min(72, item.fontSize + 2) })}
                          className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px] font-bold cursor-pointer"
                          title="放大字體"
                        >
                          A+
                        </button>
                      </div>

                      <div className="w-[1px] h-3.5 bg-neutral-700" />

                      {/* Underline toggle */}
                      <button
                        type="button"
                        onClick={() => onUpdateTextItem?.(item.id, { underline: !item.underline })}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold underline cursor-pointer ${
                          item.underline ? 'bg-blue-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
                        }`}
                        title="切換底線"
                      >
                        U
                      </button>

                      {/* Delete text item */}
                      {textItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onDeleteTextItem(item.id)}
                          className="p-1 text-red-400 hover:text-red-300 hover:bg-red-950/50 rounded cursor-pointer"
                          title="刪除此文字組"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Drag Handle & Status Header (hidden while dragging so no big blue block appears during drag, only shown during selection/edit; lower redundant done button removed) */}
                  {!isBeingDragged && (
                    <div
                      onMouseDown={(e) => handleStartDragText(e, item.id, item.x, item.y, false)}
                      className="flex items-center justify-between px-2 py-0.5 rounded-t text-[10px] font-bold shadow-xs whitespace-nowrap cursor-move border border-b-0 transition-colors w-full bg-blue-600 text-white border-blue-600"
                      title="按住此處可自由拖曳移動位置"
                    >
                      <div className="flex items-center space-x-1 text-blue-100">
                        <Move className="w-3 h-3" />
                        <span>#{idx + 1} 拖曳移動</span>
                      </div>

                      <span className="text-[9px] text-blue-100 font-mono">({item.x}, {item.y})</span>
                    </div>
                  )}

                  {/* Direct In-Place Editable Text Area & Resizable Container - ENTIRE CONTAINER DRAGGABLE */}
                  <div
                    onMouseDown={(e) => handleStartDragText(e, item.id, item.x, item.y, false)}
                    className={`relative bg-white border border-blue-500 ring-2 ring-blue-300/60 shadow-lg cursor-move ${
                      isBeingDragged ? 'rounded' : 'rounded-b'
                    }`}
                    title="按住此方框任意處可拖曳移動，點擊文字可直接編輯"
                  >
                    <textarea
                      value={item.text}
                      onChange={(e) => onUpdateTextItem?.(item.id, { text: e.target.value })}
                      onFocus={() => {
                        onSelectActiveText(item.id);
                        setEditingTextId(item.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
                          handleCompleteTextEdit();
                        }
                      }}
                      onMouseDown={(e) => {
                        handleStartDragText(e, item.id, item.x, item.y, true);
                      }}
                      placeholder="在此直接輸入文字..."
                      rows={Math.max(1, (item.text || '').split('\n').length)}
                      className="p-2 bg-transparent resize-none outline-none block font-bold leading-tight"
                      style={{
                        color: item.color,
                        textDecoration: item.underline ? 'underline' : 'none',
                        fontSize: `${Math.max(11, item.fontSize * scale)}px`,
                        lineHeight: 1.25,
                        textDecorationThickness: '2px',
                        width: item.width ? `${item.width * scale}px` : 'auto',
                        minWidth: '130px',
                        height: item.height ? `${item.height * scale}px` : 'auto',
                      }}
                    />

                    {/* 1. Right Edge Resize Handle (Drag horizontally to resize width & wrap text) */}
                    <div
                      onMouseDown={(e) => handleStartResizeText(e, item, 'width')}
                      className="absolute -right-2 top-0 bottom-0 w-4 cursor-ew-resize flex items-center justify-center group z-50 hover:bg-blue-500/20 rounded"
                      title="向左右拖曳調整方塊寬度 (文字自動換行)"
                    >
                      <div className="w-1.5 h-6 bg-blue-600 rounded-full shadow-md group-hover:scale-125 transition-transform" />
                    </div>

                    {/* 2. Bottom Edge Resize Handle (Drag vertically to resize height) */}
                    <div
                      onMouseDown={(e) => handleStartResizeText(e, item, 'height')}
                      className="absolute left-4 right-4 -bottom-2 h-4 cursor-ns-resize flex items-center justify-center group z-50 hover:bg-blue-500/20 rounded"
                      title="向下拖曳調整方塊高度"
                    >
                      <div className="h-1.5 w-6 bg-blue-600 rounded-full shadow-md group-hover:scale-125 transition-transform" />
                    </div>

                    {/* 3. Bottom-Right Corner Resize Handle (Drag diagonally to scale width & font size) */}
                    <div
                      onMouseDown={(e) => handleStartResizeText(e, item, 'corner')}
                      className="absolute -bottom-2.5 -right-2.5 w-5 h-5 bg-blue-600 border-2 border-white rounded-full cursor-nwse-resize shadow-lg flex items-center justify-center hover:scale-125 active:scale-110 transition-transform z-50"
                      title="拖曳右下角調整方塊大小與文字縮放"
                    >
                      <div className="w-1.5 h-1.5 bg-white rounded-full" />
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};
