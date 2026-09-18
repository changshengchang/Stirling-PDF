import React, { useState, useEffect } from 'react';
import { Terminal, CheckCircle2, AlertCircle, Play, Server } from 'lucide-react';

export const ApiExplorer: React.FC = () => {
  const [healthStatus, setHealthStatus] = useState<any>(null);
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setHealthStatus(data);

      const res2 = await fetch('/api/v1/info/status');
      const data2 = await res2.json();
      setSystemInfo(data2);
    } catch (err: any) {
      setHealthStatus({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  const endpoints = [
    {
      method: 'POST',
      path: '/api/v1/general/merge-pdfs',
      desc: 'Merges multiple uploaded PDF files into a single document.',
      curl: 'curl -X POST http://localhost:3000/api/v1/general/merge-pdfs \\\n  -F "fileInput=@doc1.pdf" \\\n  -F "fileInput=@doc2.pdf" \\\n  -o merged.pdf',
    },
    {
      method: 'POST',
      path: '/api/v1/general/split-pages',
      desc: 'Extracts specified pages (e.g. "1-3,5") from an input PDF.',
      curl: 'curl -X POST http://localhost:3000/api/v1/general/split-pages \\\n  -F "fileInput=@document.pdf" \\\n  -F "pages=1-2" \\\n  -o split.pdf',
    },
    {
      method: 'POST',
      path: '/api/v1/general/rotate-pdf',
      desc: 'Rotates document pages by 90, 180, or 270 degrees.',
      curl: 'curl -X POST http://localhost:3000/api/v1/general/rotate-pdf \\\n  -F "fileInput=@document.pdf" \\\n  -F "angle=90" \\\n  -o rotated.pdf',
    },
    {
      method: 'POST',
      path: '/api/v1/misc/add-page-numbers',
      desc: 'Stamps page numbers onto each page with customized alignment.',
      curl: 'curl -X POST http://localhost:3000/api/v1/misc/add-page-numbers \\\n  -F "fileInput=@document.pdf" \\\n  -F "position=bottom-center" \\\n  -o numbered.pdf',
    },
    {
      method: 'POST',
      path: '/api/v1/security/add-watermark',
      desc: 'Applies diagonal opacity-controlled text watermarks across pages.',
      curl: 'curl -X POST http://localhost:3000/api/v1/security/add-watermark \\\n  -F "fileInput=@document.pdf" \\\n  -F "watermarkText=CONFIDENTIAL" \\\n  -o watermarked.pdf',
    },
    {
      method: 'POST',
      path: '/api/v1/security/get-info-on-pdf',
      desc: 'Extracts metadata and structural metrics as JSON.',
      curl: 'curl -X POST http://localhost:3000/api/v1/security/get-info-on-pdf \\\n  -F "fileInput=@document.pdf"',
    },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* Overview Card */}
      <div className="bg-white rounded-xl border border-neutral-200 p-6 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-lg bg-neutral-900 text-white">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-neutral-900">Stirling PDF REST API</h2>
              <p className="text-xs text-neutral-500">
                All tools are exposed as standard REST endpoints compatible with CLI and CI/CD pipelines.
              </p>
            </div>
          </div>
          <button
            onClick={fetchHealth}
            disabled={loading}
            className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold rounded-md flex items-center space-x-1.5 transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Test Health</span>
          </button>
        </div>

        {healthStatus && (
          <div className="mt-4 p-3.5 bg-neutral-50 rounded-lg border border-neutral-200 text-xs font-mono flex items-center justify-between">
            <div>
              <span className="text-neutral-500 font-semibold">GET /api/health: </span>
              <span className="text-green-700 font-bold">{JSON.stringify(healthStatus)}</span>
            </div>
            {systemInfo && (
              <span className="text-neutral-500 hidden sm:inline">
                Status: <span className="text-green-700 font-semibold">{systemInfo.status}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Endpoints List */}
      <div className="space-y-4">
        <h3 className="text-base font-bold text-neutral-900 flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-red-600" />
          <span>Core Endpoints</span>
        </h3>

        <div className="grid gap-4">
          {endpoints.map((ep, idx) => (
            <div key={idx} className="bg-white rounded-xl border border-neutral-200 p-5 shadow-xs">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 text-xs font-bold bg-green-100 text-green-800 rounded-md">
                    {ep.method}
                  </span>
                  <span className="text-sm font-semibold font-mono text-neutral-900">{ep.path}</span>
                </div>
              </div>
              <p className="text-xs text-neutral-600 mb-3">{ep.desc}</p>
              <div className="p-3 bg-neutral-900 rounded-lg text-neutral-100 text-xs font-mono overflow-x-auto">
                <pre>{ep.curl}</pre>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
