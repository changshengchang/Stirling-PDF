import express from 'express';
import path from 'path';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib';
import { createServer as createViteServer } from 'vite';

interface StoredPdf {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  pageCount: number;
  createdAt: number;
}

const fileStore = new Map<string, StoredPdf>();

// Periodically clean up files older than 1 hour
setInterval(() => {
  const now = Date.now();
  for (const [id, item] of fileStore.entries()) {
    if (now - item.createdAt > 60 * 60 * 1000) {
      fileStore.delete(id);
    }
  }
}, 5 * 60 * 1000);

function registerFile(buffer: Buffer, filename: string, pageCount: number): { fileId: string; previewUrl: string; downloadUrl: string } {
  const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  fileStore.set(fileId, {
    buffer,
    filename,
    mimeType: 'application/pdf',
    pageCount,
    createdAt: Date.now(),
  });
  return {
    fileId,
    previewUrl: `/api/v1/preview/${fileId}`,
    downloadUrl: `/api/v1/download/${fileId}`,
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(
    cors({
      exposedHeaders: ['Content-Disposition', 'X-File-Id', 'X-Preview-Url', 'X-Download-Url', 'X-Page-Count'],
    })
  );
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  const storage = multer.memoryStorage();
  const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  // Health and System Info
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', app: 'Stirling-PDF', version: '1.0.0', runtime: 'Node.js' });
  });

  app.get('/api/v1/info/status', (req, res) => {
    res.json({
      status: 'UP',
      app: 'Stirling PDF',
      version: '1.0.0',
      features: ['merge', 'split', 'rotate', 'page-numbers', 'watermark', 'compress', 'info'],
    });
  });

  // Dedicated Preview Endpoint (served as inline PDF over HTTPS)
  app.get('/api/v1/preview/:fileId', (req, res) => {
    const item = fileStore.get(req.params.fileId);
    if (!item) {
      return res.status(404).send('Document expired or not found. Please re-run the tool.');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(item.filename)}"`);
    res.setHeader('Content-Length', item.buffer.length.toString());
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(item.buffer);
  });

  // Dedicated Download Endpoint (served as binary stream attachment over HTTPS)
  app.get('/api/v1/download/:fileId', (req, res) => {
    const item = fileStore.get(req.params.fileId);
    if (!item) {
      return res.status(404).send('Document expired or not found. Please re-run the tool.');
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(item.filename)}"`);
    res.setHeader('Content-Length', item.buffer.length.toString());
    res.setHeader('Cache-Control', 'no-cache');
    res.send(item.buffer);
  });

  // Helper to respond with either JSON or PDF buffer based on Accept header
  const respondWithPdf = (
    req: express.Request,
    res: express.Response,
    pdfBuffer: Buffer,
    filename: string,
    pageCount: number
  ) => {
    const { fileId, previewUrl, downloadUrl } = registerFile(pdfBuffer, filename, pageCount);

    res.setHeader('X-File-Id', fileId);
    res.setHeader('X-Preview-Url', previewUrl);
    res.setHeader('X-Download-Url', downloadUrl);
    res.setHeader('X-Page-Count', pageCount.toString());

    if (req.headers.accept?.includes('application/json') || req.query.format === 'json') {
      return res.json({
        success: true,
        fileId,
        filename,
        fileSize: pdfBuffer.length,
        pageCount,
        previewUrl,
        downloadUrl,
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  };

  // Tool 1: Merge PDFs (/api/v1/general/merge-pdfs)
  app.post('/api/v1/general/merge-pdfs', upload.array('fileInput') as any, async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files provided for merging. Please select at least two PDF files.' });
      }

      const mergedPdf = await PDFDocument.create();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const uint8 = new Uint8Array(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength);

        // Check PDF header
        const header = Buffer.from(uint8.slice(0, 5)).toString('ascii');
        if (!header.startsWith('%PDF-')) {
          return res.status(400).json({
            error: `File "${file.originalname || `File ${i + 1}`}" is not a valid PDF document.`,
          });
        }

        try {
          const donorPdf = await PDFDocument.load(uint8, {
            ignoreEncryption: true,
            throwOnInvalidObject: false,
            capNumbers: true,
          });
          const pageIndices = donorPdf.getPageIndices();
          if (pageIndices.length > 0) {
            const copiedPages = await mergedPdf.copyPages(donorPdf, pageIndices);
            copiedPages.forEach((page) => mergedPdf.addPage(page));
          }
        } catch (loadErr: any) {
          console.error(`Error processing file ${file.originalname}:`, loadErr);
          return res.status(400).json({
            error: `Failed to read "${file.originalname}": ${loadErr.message || 'File may be corrupted or password protected.'}`,
          });
        }
      }

      if (mergedPdf.getPageCount() === 0) {
        return res.status(400).json({ error: 'None of the uploaded PDF files contained readable pages.' });
      }

      const pdfBytes = await mergedPdf.save({ useObjectStreams: false });
      const buf = Buffer.from(pdfBytes);
      respondWithPdf(req, res, buf, 'merged.pdf', mergedPdf.getPageCount());
    } catch (err: any) {
      console.error('Merge error:', err);
      res.status(500).json({ error: err.message || 'Failed to merge PDFs' });
    }
  });

  // Tool 2: Split Pages (/api/v1/general/split-pages)
  app.post('/api/v1/general/split-pages', upload.single('fileInput') as any, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const uint8 = new Uint8Array(req.file.buffer.buffer, req.file.buffer.byteOffset, req.file.buffer.byteLength);
      const donorPdf = await PDFDocument.load(uint8, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        capNumbers: true,
      });
      const totalPages = donorPdf.getPageCount();

      const pagesStr = (req.body.pages || req.body.pageNumbers || 'all').toString().trim();
      let targetIndices: number[] = [];

      if (pagesStr.toLowerCase() === 'all') {
        targetIndices = donorPdf.getPageIndices();
      } else {
        const segments = pagesStr.split(',');
        for (const seg of segments) {
          const trimmed = seg.trim();
          if (trimmed.includes('-')) {
            const [startStr, endStr] = trimmed.split('-');
            const start = Math.max(1, parseInt(startStr, 10));
            const end = Math.min(totalPages, parseInt(endStr, 10));
            for (let p = start; p <= end; p++) {
              if (!targetIndices.includes(p - 1)) targetIndices.push(p - 1);
            }
          } else {
            const pageNum = parseInt(trimmed, 10);
            if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
              if (!targetIndices.includes(pageNum - 1)) targetIndices.push(pageNum - 1);
            }
          }
        }
      }

      if (targetIndices.length === 0) {
        targetIndices = donorPdf.getPageIndices();
      }

      const outputPdf = await PDFDocument.create();
      const copiedPages = await outputPdf.copyPages(donorPdf, targetIndices);
      copiedPages.forEach((page) => outputPdf.addPage(page));

      const pdfBytes = await outputPdf.save({ useObjectStreams: false });
      const buf = Buffer.from(pdfBytes);
      respondWithPdf(req, res, buf, 'split.pdf', outputPdf.getPageCount());
    } catch (err: any) {
      console.error('Split error:', err);
      res.status(500).json({ error: err.message || 'Failed to split PDF' });
    }
  });

  // Custom fontkit wrapper to safely handle TrueType (.ttf) and TrueType Collection (.ttc) files
  const rawFontkit: any = (fontkit as any)?.default || fontkit;
  const customFontkit: any = {
    ...rawFontkit,
    create: (buf: any, postscriptName?: string) => {
      const fn = rawFontkit?.create || rawFontkit?.default?.create;
      if (typeof fn === 'function') {
        const res = fn(buf, postscriptName);
        if (res && res.fonts && res.fonts.length > 0) {
          return res.fonts[0];
        }
        return res;
      }
      throw new Error('fontkit.create is not available');
    },
  };

  function extractTtcFont0(ttcBuf: Buffer): Buffer {
    if (ttcBuf.length < 16 || ttcBuf.slice(0, 4).toString() !== 'ttcf') {
      return ttcBuf;
    }
    try {
      const font0Offset = ttcBuf.readUInt32BE(12);
      const numTables = ttcBuf.readUInt16BE(font0Offset + 4);
      const headerSize = 12 + numTables * 16;
      const tables: Array<{ tag: string; checkSum: number; length: number; data: Buffer; newOffset?: number }> = [];
      for (let t = 0; t < numTables; t++) {
        const tOffset = font0Offset + 12 + t * 16;
        const tag = ttcBuf.slice(tOffset, tOffset + 4).toString();
        const checkSum = ttcBuf.readUInt32BE(tOffset + 4);
        const offset = ttcBuf.readUInt32BE(tOffset + 8);
        const length = ttcBuf.readUInt32BE(tOffset + 12);
        const data = ttcBuf.slice(offset, offset + length);
        tables.push({ tag, checkSum, length, data });
      }
      tables.sort((a, b) => a.tag.localeCompare(b.tag));
      let currentOffset = headerSize;
      for (const t of tables) {
        currentOffset = (currentOffset + 3) & ~3;
        t.newOffset = currentOffset;
        currentOffset += t.length;
      }
      const outBuf = Buffer.alloc(currentOffset);
      outBuf.writeUInt32BE(0x00010000, 0);
      outBuf.writeUInt16BE(numTables, 4);
      const maxPowerOf2 = Math.pow(2, Math.floor(Math.log2(numTables)));
      const searchRange = maxPowerOf2 * 16;
      outBuf.writeUInt16BE(searchRange, 6);
      outBuf.writeUInt16BE(Math.floor(Math.log2(numTables)), 8);
      outBuf.writeUInt16BE(numTables * 16 - searchRange, 10);
      for (let i = 0; i < tables.length; i++) {
        const t = tables[i];
        const recOffset = 12 + i * 16;
        outBuf.write(t.tag, recOffset, 4, 'ascii');
        outBuf.writeUInt32BE(t.checkSum, recOffset + 4);
        outBuf.writeUInt32BE(t.newOffset!, recOffset + 8);
        outBuf.writeUInt32BE(t.length, recOffset + 12);
        t.data.copy(outBuf, t.newOffset!);
      }
      return outBuf;
    } catch (err) {
      console.warn('Failed to extract TTF from TTC collection, falling back to original buffer:', err);
      return ttcBuf;
    }
  }

  let cjkFontBuffer: Buffer | null = null;
  const FONT_CANDIDATE_PATHS = [
    path.join(process.cwd(), 'public/fonts/NotoSansTC-Regular.ttf'),
    path.join(process.cwd(), 'public/fonts/cjk-font.ttf'),
    path.join(process.cwd(), 'app/core/src/main/resources/static/fonts/NotoSansTC-Regular.ttf'),
    '/usr/share/fonts/truetype/noto/NotoSansTC-Regular.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  ];

  for (const fontPath of FONT_CANDIDATE_PATHS) {
    try {
      if (fs.existsSync(fontPath)) {
        const rawBuf = fs.readFileSync(fontPath);
        cjkFontBuffer = extractTtcFont0(rawBuf);
        console.log('Successfully loaded Chinese TrueType font from:', fontPath, 'size:', cjkFontBuffer.length);
        break;
      }
    } catch (e) {
      console.warn('Could not read font from:', fontPath, e);
    }
  }

  const serverDocFontMap = new WeakMap<PDFDocument, any>();

  // Helper to embed appropriate font (supporting Traditional/Simplified Chinese, Japanese, and Latin)
  async function getAppropriateFont(pdfDoc: PDFDocument, text: string, preferBold: boolean = true) {
    const hasNonAscii = /[^\u0000-\u007F]/.test(text);
    if (cjkFontBuffer && hasNonAscii) {
      if (serverDocFontMap.has(pdfDoc)) {
        return serverDocFontMap.get(pdfDoc);
      }
      try {
        pdfDoc.registerFontkit(customFontkit);
        const embeddedFont = await pdfDoc.embedFont(cjkFontBuffer, { subset: true });
        serverDocFontMap.set(pdfDoc, embeddedFont);
        return embeddedFont;
      } catch (err: any) {
        console.error('Failed to embed CJK font in pdfDoc:', err);
        throw new Error(`無法將中文字型嵌入 PDF: ${err?.message || err}`);
      }
    }
    try {
      return await pdfDoc.embedFont(preferBold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
    } catch (e) {
      if (cjkFontBuffer) {
        if (serverDocFontMap.has(pdfDoc)) {
          return serverDocFontMap.get(pdfDoc);
        }
        try {
          pdfDoc.registerFontkit(customFontkit);
          const embeddedFont = await pdfDoc.embedFont(cjkFontBuffer, { subset: true });
          serverDocFontMap.set(pdfDoc, embeddedFont);
          return embeddedFont;
        } catch (fontErr: any) {
          console.error('Fallback font embedding failed:', fontErr);
        }
      }
      throw e;
    }
  }

  // Endpoint to serve CJK font to client for browser-side rendering if needed
  app.get('/api/v1/fonts/cjk', (req, res) => {
    if (cjkFontBuffer) {
      res.setHeader('Content-Type', 'font/ttf');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cjkFontBuffer);
    } else {
      res.status(404).json({ error: 'CJK font not available' });
    }
  });

  // Helper to convert HEX colors (e.g. #dc2626 or #333) to PDF RGB ratios (0-1)
  function hexToRgb(hex: string): { r: number; g: number; b: number } {
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
  }

  // Tool: Add Text, Markups & Pasted Images (/api/v1/general/add-text)
  app.post('/api/v1/general/add-text', upload.single('fileInput') as any, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      // Parse multi-text items, markups, and pasted images if sent
      let textItems: any[] = [];
      if (req.body.textItems) {
        try {
          textItems = JSON.parse(req.body.textItems);
        } catch (e) {
          textItems = [];
        }
      }

      // If textItems is empty, fallback to single legacy text parameters
      if (textItems.length === 0) {
        const text = (req.body.text || req.body.customText || '').toString();
        if (text.trim()) {
          const colorHex = (req.body.color || req.body.textColor || '#000000').toString();
          const isUnderline = req.body.underline === true || req.body.underline === 'true' || req.body.underline === '1';
          const fontSize = Math.max(6, Math.min(120, parseInt(req.body.fontSize || '16', 10)));
          const position = (req.body.position || 'custom').toString();
          const targetPageStr = (req.body.targetPages || req.body.pages || req.body.page || '1').toString().trim();
          const customX = parseFloat(req.body.x || '50');
          const customY = parseFloat(req.body.y || '50');
          textItems.push({
            id: 'default',
            text,
            color: colorHex,
            underline: isUnderline,
            fontSize,
            position,
            page: targetPageStr === 'all' ? 'all' : parseInt(targetPageStr, 10) || 1,
            x: customX,
            y: customY,
          });
        }
      }

      let markups: any[] = [];
      if (req.body.markups) {
        try {
          markups = JSON.parse(req.body.markups);
        } catch (e) {
          markups = [];
        }
      }

      let images: any[] = [];
      if (req.body.images) {
        try {
          images = JSON.parse(req.body.images);
        } catch (e) {
          images = [];
        }
      }

      if (textItems.length === 0 && markups.length === 0 && images.length === 0) {
        return res.status(400).json({ error: '請提供新增文字、劃線標記或貼上圖片內容。' });
      }

      const uint8 = new Uint8Array(req.file.buffer.buffer, req.file.buffer.byteOffset, req.file.buffer.byteLength);
      const pdfDoc = await PDFDocument.load(uint8, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        capNumbers: true,
      });

      const pages = pdfDoc.getPages();
      const totalPages = pages.length;

      // 1. Draw Markups (螢光筆塗色標記、原文劃底線、刪除線、方框註記)
      for (const markup of markups) {
        const pageIdx = (parseInt(markup.page, 10) || 1) - 1;
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
      for (const img of images) {
        if (!img.dataUrl) continue;
        const pageIdx = (parseInt(img.page, 10) || 1) - 1;
        if (pageIdx < 0 || pageIdx >= totalPages) continue;

        const page = pages[pageIdx];
        const base64Data = img.dataUrl.includes('base64,') ? img.dataUrl.split('base64,')[1] : img.dataUrl;
        const imgBuffer = Buffer.from(base64Data, 'base64');

        let embeddedImage: any = null;
        try {
          if (img.dataUrl.includes('image/png') || !img.dataUrl.includes('image/jp')) {
            embeddedImage = await pdfDoc.embedPng(imgBuffer);
          } else {
            embeddedImage = await pdfDoc.embedJpg(imgBuffer);
          }
        } catch (e1) {
          try {
            embeddedImage = await pdfDoc.embedJpg(imgBuffer);
          } catch (e2) {
            console.warn('Could not embed image:', e1, e2);
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

        const itemFont = await getAppropriateFont(pdfDoc, item.text, true);
        const itemRgb = hexToRgb(item.color || '#000000');
        const itemColor = rgb(itemRgb.r, itemRgb.g, itemRgb.b);
        const itemFontSize = Math.max(6, Math.min(120, parseInt(item.fontSize || '16', 10)));
        const itemUnderline = item.underline === true || item.underline === 'true' || item.underline === '1';
        const itemBoxWidth = item.width && item.width > 20 ? item.width : undefined;
        let itemLines: string[] = [];
        const rawLines = item.text.split(/\r?\n/);

        if (itemBoxWidth) {
          for (const rawLine of rawLines) {
            if (!rawLine) {
              itemLines.push('');
              continue;
            }
            let cur = '';
            for (const ch of rawLine) {
              const test = cur + ch;
              if (cur.length > 0 && itemFont.widthOfTextAtSize(test, itemFontSize) > itemBoxWidth) {
                itemLines.push(cur);
                cur = ch;
              } else {
                cur = test;
              }
            }
            if (cur) itemLines.push(cur);
          }
        } else {
          itemLines = rawLines;
        }

        const itemLineHeight = itemFontSize * 1.35;

        // Determine target pages for this text item
        const targetPageStr = (item.page || '1').toString().trim();
        let itemPages: number[] = [];
        if (targetPageStr.toLowerCase() === 'all') {
          itemPages = pages.map((_, i) => i);
        } else {
          const segments = targetPageStr.split(',');
          for (const seg of segments) {
            const trimmed = seg.trim();
            if (trimmed.includes('-')) {
              const [startStr, endStr] = trimmed.split('-');
              const start = Math.max(1, parseInt(startStr, 10));
              const end = Math.min(totalPages, parseInt(endStr, 10));
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

        for (const pIdx of itemPages) {
          const page = pages[pIdx];
          const { width, height } = page.getSize();

          const lineWidths = itemLines.map((line: string) => (line.length > 0 ? itemFont.widthOfTextAtSize(line, itemFontSize) : 0));
          const maxLineWidth = Math.max(...lineWidths, 0);
          const totalBlockHeight = itemLines.length * itemLineHeight;

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

          itemLines.forEach((line: string, lineIdx: number) => {
            if (!line || line.trim().length === 0) return;
            const curY = startY - lineIdx * itemLineHeight;
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
              const underlineThickness = Math.max(1, itemFontSize / 14);
              page.drawLine({
                start: { x: curX, y: curY - underlineOffset },
                end: { x: curX + curLineWidth, y: curY - underlineOffset },
                thickness: underlineThickness,
                color: itemColor,
              });
            }
          });
        }
      }

      const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
      const buf = Buffer.from(pdfBytes);
      respondWithPdf(req, res, buf, 'annotated_text.pdf', pages.length);
    } catch (err: any) {
      console.error('Add text error:', err);
      res.status(500).json({ error: err.message || 'Failed to add text to PDF' });
    }
  });

  // Tool 3: Rotate PDF (/api/v1/general/rotate-pdf)
  app.post('/api/v1/general/rotate-pdf', upload.single('fileInput') as any, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const uint8 = new Uint8Array(req.file.buffer.buffer, req.file.buffer.byteOffset, req.file.buffer.byteLength);
      const angle = parseInt(req.body.angle || req.body.rotation || '90', 10);
      const pdfDoc = await PDFDocument.load(uint8, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        capNumbers: true,
      });
      const pages = pdfDoc.getPages();

      for (const page of pages) {
        const currentRotation = page.getRotation().angle;
        page.setRotation(degrees((currentRotation + angle) % 360));
      }

      const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
      const buf = Buffer.from(pdfBytes);
      respondWithPdf(req, res, buf, 'rotated.pdf', pages.length);
    } catch (err: any) {
      console.error('Rotate error:', err);
      res.status(500).json({ error: err.message || 'Failed to rotate PDF' });
    }
  });

  // Tool 4: Add Page Numbers (/api/v1/misc/add-page-numbers)
  app.post('/api/v1/misc/add-page-numbers', upload.single('fileInput') as any, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const startingNumber = parseInt(req.body.startingNumber || '1', 10);
      const position = req.body.position || 'bottom-center';
      const customPrefix = req.body.customText || 'Page ';
      const fontSize = parseInt(req.body.fontSize || '10', 10);

      const uint8 = new Uint8Array(req.file.buffer.buffer, req.file.buffer.byteOffset, req.file.buffer.byteLength);
      const pdfDoc = await PDFDocument.load(uint8, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        capNumbers: true,
      });
      const font = await getAppropriateFont(pdfDoc, customPrefix, false);
      const pages = pdfDoc.getPages();
      const totalPages = pages.length;

      pages.forEach((page, idx) => {
        const { width } = page.getSize();
        const pageNum = startingNumber + idx;
        const text = `${customPrefix}${pageNum} / ${totalPages + startingNumber - 1}`;
        const textWidth = font.widthOfTextAtSize(text, fontSize);

        let x = (width - textWidth) / 2;
        if (position === 'bottom-left') x = 36;
        if (position === 'bottom-right') x = width - textWidth - 36;

        page.drawText(text, {
          x,
          y: 24,
          size: fontSize,
          font,
          color: rgb(0.2, 0.2, 0.2),
        });
      });

      const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
      const buf = Buffer.from(pdfBytes);
      respondWithPdf(req, res, buf, 'numbered.pdf', pages.length);
    } catch (err: any) {
      console.error('Page numbers error:', err);
      res.status(500).json({ error: err.message || 'Failed to add page numbers' });
    }
  });

  // Tool 5: Watermark (/api/v1/security/add-watermark)
  app.post('/api/v1/security/add-watermark', upload.single('fileInput') as any, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const watermarkText = req.body.watermarkText || 'CONFIDENTIAL';
      const fontSize = parseInt(req.body.fontSize || '48', 10);
      const opacity = parseFloat(req.body.opacity || '0.25');

      const uint8 = new Uint8Array(req.file.buffer.buffer, req.file.buffer.byteOffset, req.file.buffer.byteLength);
      const pdfDoc = await PDFDocument.load(uint8, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        capNumbers: true,
      });
      const font = await getAppropriateFont(pdfDoc, watermarkText, true);
      const pages = pdfDoc.getPages();

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

      const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
      const buf = Buffer.from(pdfBytes);
      respondWithPdf(req, res, buf, 'watermarked.pdf', pages.length);
    } catch (err: any) {
      console.error('Watermark error:', err);
      res.status(500).json({ error: err.message || 'Failed to add watermark' });
    }
  });

  // Tool 6: PDF Info (/api/v1/security/get-info-on-pdf)
  app.post('/api/v1/security/get-info-on-pdf', upload.single('fileInput') as any, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const uint8 = new Uint8Array(req.file.buffer.buffer, req.file.buffer.byteOffset, req.file.buffer.byteLength);
      const pdfDoc = await PDFDocument.load(uint8, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        capNumbers: true,
      });
      const pageCount = pdfDoc.getPageCount();
      const title = pdfDoc.getTitle() || 'Untitled';
      const author = pdfDoc.getAuthor() || 'Unknown';
      const subject = pdfDoc.getSubject() || '';
      const creator = pdfDoc.getCreator() || 'Stirling-PDF';
      const producer = pdfDoc.getProducer() || 'pdf-lib';
      const creationDate = pdfDoc.getCreationDate()?.toISOString() || null;
      const modificationDate = pdfDoc.getModificationDate()?.toISOString() || null;

      res.json({
        title,
        author,
        subject,
        creator,
        producer,
        creationDate,
        modificationDate,
        pageCount,
        fileSize: req.file.size,
      });
    } catch (err: any) {
      console.error('Get info error:', err);
      res.status(500).json({ error: err.message || 'Failed to inspect PDF' });
    }
  });

  // Tool 7: Compress/Optimize (/api/v1/misc/compress-pdf)
  app.post('/api/v1/misc/compress-pdf', upload.single('fileInput') as any, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const uint8 = new Uint8Array(req.file.buffer.buffer, req.file.buffer.byteOffset, req.file.buffer.byteLength);
      const pdfDoc = await PDFDocument.load(uint8, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        capNumbers: true,
      });
      const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
      const buf = Buffer.from(pdfBytes);
      respondWithPdf(req, res, buf, 'compressed.pdf', pdfDoc.getPageCount());
    } catch (err: any) {
      console.error('Compress error:', err);
      res.status(500).json({ error: err.message || 'Failed to compress PDF' });
    }
  });

  // Catch-all for other /api/v1 routes
  app.all('/api/v1/*', (req, res) => {
    res.status(501).json({
      error: 'Endpoint scheduled for future migration',
      path: req.originalUrl,
      method: req.method,
    });
  });

  // Vite middleware for development / Static file serving for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Stirling-PDF running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
