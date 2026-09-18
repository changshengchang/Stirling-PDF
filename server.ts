import express from 'express';
import path from 'path';
import cors from 'cors';
import multer from 'multer';
import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
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

  // Tool 1: Merge PDFs (/api/v1/general/merge-pdfs)
  app.post('/api/v1/general/merge-pdfs', upload.array('fileInput') as any, async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files provided for merging' });
      }

      const mergedPdf = await PDFDocument.create();

      for (const file of files) {
        const donorPdf = await PDFDocument.load(file.buffer, { ignoreEncryption: true });
        const copiedPages = await mergedPdf.copyPages(donorPdf, donorPdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }

      const pdfBytes = await mergedPdf.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="merged.pdf"');
      res.send(Buffer.from(pdfBytes));
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

      const pagesStr = (req.body.pages || req.body.pageNumbers || 'all').toString().trim();
      const donorPdf = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true });
      const totalPages = donorPdf.getPageCount();

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

      const pdfBytes = await outputPdf.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="split.pdf"');
      res.send(Buffer.from(pdfBytes));
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

      const angle = parseInt(req.body.angle || req.body.rotation || '90', 10);
      const pdfDoc = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();

      for (const page of pages) {
        const currentRotation = page.getRotation().angle;
        page.setRotation(degrees((currentRotation + angle) % 360));
      }

      const pdfBytes = await pdfDoc.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="rotated.pdf"');
      res.send(Buffer.from(pdfBytes));
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

      const pdfDoc = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true });
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

      const pdfBytes = await pdfDoc.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="numbered.pdf"');
      res.send(Buffer.from(pdfBytes));
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

      const pdfDoc = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true });
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

      const pdfBytes = await pdfDoc.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="watermarked.pdf"');
      res.send(Buffer.from(pdfBytes));
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

      const pdfDoc = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true });
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

      const pdfDoc = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true });
      const pdfBytes = await pdfDoc.save({ useObjectStreams: true });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="compressed.pdf"');
      res.send(Buffer.from(pdfBytes));
    } catch (err: any) {
      console.error('Compress error:', err);
      res.status(500).json({ error: err.message || 'Failed to compress PDF' });
    }
  });

  // Catch-all for other /api/v1 routes (Stub as requested by migration guide)
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
