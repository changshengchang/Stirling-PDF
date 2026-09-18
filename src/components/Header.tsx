import React from 'react';
import { FileText, Code, Shield } from 'lucide-react';
import { ToolCategory } from '../types';

interface HeaderProps {
  activeCategory: ToolCategory;
  onSelectCategory: (cat: ToolCategory) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeView: 'tools' | 'api';
  onViewChange: (view: 'tools' | 'api') => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeCategory,
  onSelectCategory,
  searchQuery,
  onSearchChange,
  activeView,
  onViewChange,
}) => {
  const categories: { id: ToolCategory; label: string }[] = [
    { id: 'all', label: 'All Tools' },
    { id: 'general', label: 'General' },
    { id: 'security', label: 'Security' },
    { id: 'misc', label: 'Misc' },
  ];

  return (
    <header className="border-b border-neutral-200 bg-white sticky top-0 z-20 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => onViewChange('tools')}>
            <div className="w-10 h-10 rounded-lg bg-red-600 flex items-center justify-center text-white shadow-sm">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg text-neutral-900 tracking-tight">Stirling PDF</span>
                <span className="text-xs bg-red-100 text-red-700 font-medium px-2 py-0.5 rounded-full">v1.0</span>
              </div>
              <p className="text-xs text-neutral-500 hidden sm:block">Open-Source Local PDF Suite</p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <button
              id="view-tools-btn"
              onClick={() => onViewChange('tools')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeView === 'tools'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
              }`}
            >
              Tools
            </button>
            <button
              id="view-api-btn"
              onClick={() => onViewChange('api')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeView === 'api'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
              }`}
            >
              <Code className="w-4 h-4" />
              <span>API Explorer</span>
            </button>
          </div>
        </div>

        {activeView === 'tools' && (
          <div className="py-3 border-t border-neutral-100 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center space-x-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  id={`cat-btn-${cat.id}`}
                  onClick={() => onSelectCategory(cat.id)}
                  className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-full transition-colors whitespace-nowrap ${
                    activeCategory === cat.id
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : 'text-neutral-600 hover:bg-neutral-100 border border-transparent'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="w-full sm:w-72">
              <input
                id="search-tools-input"
                type="text"
                placeholder="Search tools (e.g. merge, rotate)..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-neutral-200 bg-neutral-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
              />
            </div>
          </div>
        )}
      </div>
    </header>
  );
};
