export type ToolCategory = 'all' | 'general' | 'security' | 'convert' | 'misc';

export interface PdfTool {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  icon: string;
  endpoint: string;
  multiFile?: boolean;
  popular?: boolean;
}

export interface PdfMetadata {
  title: string;
  author: string;
  subject: string;
  creator: string;
  producer: string;
  creationDate: string | null;
  modificationDate: string | null;
  pageCount: number;
  fileSize: number;
}

export interface TextAnnotationItem {
  id: string;
  text: string;
  color: string;
  fontSize: number;
  underline: boolean;
  page: number; // 1-based page number
  x: number;    // PDF pt from left
  y: number;    // PDF pt from bottom
  width?: number;  // PDF pt width
  height?: number; // PDF pt height
  position?: string;
}

export type MarkupType = 'highlight' | 'underline' | 'strike' | 'rectangle' | 'mask' | 'mosaic';

export interface MarkupAnnotationItem {
  id: string;
  type: MarkupType;
  page: number;     // 1-based page number
  x: number;        // PDF pt from left
  y: number;        // PDF pt from bottom
  width: number;    // PDF pt
  height: number;   // PDF pt
  color: string;    // HEX color
  opacity: number;  // 0-1
  strokeWidth?: number;
}

export interface PastedImageItem {
  id: string;
  name?: string;
  dataUrl: string;  // PNG data URL
  page: number;     // 1-based page number
  x: number;        // PDF pt from left
  y: number;        // PDF pt from bottom
  width: number;    // PDF pt
  height: number;   // PDF pt
}

