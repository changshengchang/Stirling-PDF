import express from 'express';
import path from 'path';
import cors from 'cors';
import multer from 'multer';
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
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
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
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
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
