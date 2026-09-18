import React from 'react';
import { Layers, Scissors, RotateCw, Hash, Stamp, Minimize2, FileSearch, ArrowRight, Type } from 'lucide-react';
import { PdfTool } from '../types';

interface ToolCardProps {
  tool: PdfTool;
  onSelect: (tool: PdfTool) => void;
}

export const ToolCard: React.FC<ToolCardProps> = ({ tool, onSelect }) => {
  const renderIcon = () => {
    const props = { className: 'w-6 h-6 text-red-600' };
    switch (tool.icon) {
      case 'Layers':
        return <Layers {...props} />;
      case 'Scissors':
        return <Scissors {...props} />;
      case 'Type':
        return <Type {...props} />;
      case 'RotateCw':
        return <RotateCw {...props} />;
      case 'Hash':
        return <Hash {...props} />;
      case 'Stamp':
        return <Stamp {...props} />;
      case 'Minimize2':
        return <Minimize2 {...props} />;
      case 'FileSearch':
        return <FileSearch {...props} />;
      default:
        return <FileSearch {...props} />;
    }
  };

  return (
    <div
      id={`tool-card-${tool.id}`}
      onClick={() => onSelect(tool)}
      className="group relative bg-white rounded-xl border border-neutral-200 p-5 hover:border-red-300 hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between"
    >
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="p-2.5 rounded-lg bg-red-50 group-hover:bg-red-100 transition-colors">
            {renderIcon()}
          </div>
          {tool.popular && (
            <span className="text-[11px] font-semibold text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-full">
              Popular
            </span>
          )}
        </div>
        <h3 className="text-base font-semibold text-neutral-900 group-hover:text-red-700 transition-colors">
          {tool.name}
        </h3>
        <p className="mt-1 text-sm text-neutral-600 line-clamp-2">
          {tool.description}
        </p>
      </div>

      <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-500 font-medium">
        <span className="capitalize">{tool.category}</span>
        <span className="flex items-center text-red-600 font-semibold group-hover:translate-x-1 transition-transform">
          Open Tool <ArrowRight className="w-3.5 h-3.5 ml-1" />
        </span>
      </div>
    </div>
  );
};
