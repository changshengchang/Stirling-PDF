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
