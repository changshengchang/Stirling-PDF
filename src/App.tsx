import React, { useState, useMemo, Suspense } from 'react';
import { Header } from './components/Header';
import { ToolCard } from './components/ToolCard';
import { TOOLS } from './data/tools';
import { PdfTool, ToolCategory } from './types';
import { FileText, Shield, Zap, Lock } from 'lucide-react';

const ToolWorkspace = React.lazy(() =>
  import('./components/ToolWorkspace').then((m) => ({ default: m.ToolWorkspace }))
);
const ApiExplorer = React.lazy(() =>
  import('./components/ApiExplorer').then((m) => ({ default: m.ApiExplorer }))
);

export const App: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<ToolCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTool, setSelectedTool] = useState<PdfTool | null>(null);
  const [activeView, setActiveView] = useState<'tools' | 'api'>('tools');

  const filteredTools = useMemo(() => {
    return TOOLS.filter((tool) => {
      const matchesCategory = activeCategory === 'all' || tool.category === activeCategory;
      const matchesSearch =
        tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tool.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, searchQuery]);

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col font-sans">
      <Header
        activeCategory={activeCategory}
        onSelectCategory={(cat) => {
          setActiveCategory(cat);
          setSelectedTool(null);
        }}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeView={activeView}
        onViewChange={(view) => {
          setActiveView(view);
          setSelectedTool(null);
        }}
      />

      <main className="flex-1">
        <Suspense
          fallback={
            <div className="flex flex-col items-center justify-center py-28 text-center">
              <div className="w-9 h-9 border-3 border-neutral-200 border-t-red-600 rounded-full animate-spin mb-3" />
              <p className="text-sm font-medium text-neutral-600">正在快速載入工作區...</p>
            </div>
          }
        >
          {activeView === 'api' ? (
            <ApiExplorer />
          ) : selectedTool ? (
            <ToolWorkspace tool={selectedTool} onBack={() => setSelectedTool(null)} />
          ) : (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* Feature Highlights bar */}
            <div className="mb-8 p-4 bg-white rounded-xl border border-neutral-200 shadow-xs flex flex-wrap items-center justify-between gap-4 text-xs text-neutral-600">
              <div className="flex items-center space-x-2">
                <Lock className="w-4 h-4 text-green-600" />
                <span className="font-medium text-neutral-800">100% 本地安全處理，隱私無虞</span>
              </div>
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-amber-500" />
                <span className="font-medium text-neutral-800">高速即時處理引擎</span>
              </div>
              <div className="flex items-center space-x-2">
                <Shield className="w-4 h-4 text-red-600" />
                <span className="font-medium text-neutral-800">文件不外洩，安全有保障</span>
              </div>
            </div>

            {/* Tools Grid Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-xl font-bold text-neutral-900 tracking-tight">
                  {activeCategory === 'all'
                    ? '全部 PDF 工具'
                    : activeCategory === 'general'
                    ? '常用工具'
                    : activeCategory === 'security'
                    ? '安全保密工具'
                    : '實用工具'}
                </h1>
                <p className="text-xs text-neutral-500 mt-0.5">
                  共提供 {filteredTools.length} 項功能
                </p>
              </div>
            </div>

            {/* Tools Grid */}
            {filteredTools.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {filteredTools.map((tool) => (
                  <ToolCard
                    key={tool.id}
                    tool={tool}
                    onSelect={(t) => setSelectedTool(t)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-16 bg-white rounded-xl border border-dashed border-neutral-300">
                <FileText className="w-10 h-10 text-neutral-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-neutral-700">找不到符合的工具</p>
                <p className="text-xs text-neutral-500 mt-1">請嘗試搜尋其他關鍵字，例如「文字」、「合併」或「旋轉」</p>
              </div>
            )}
          </div>
        )}
        </Suspense>
      </main>

      <footer className="border-t border-neutral-200 bg-white py-6 mt-12 text-center text-xs text-neutral-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-neutral-800">PDF自行設計線上編輯</span>
          </div>
          <p>直接線上設計與處理 PDF 文件，無外部追蹤或儲存。</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
