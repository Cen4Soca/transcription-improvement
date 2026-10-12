import { useCallback, useEffect, useRef, useState } from 'react';

export interface SpeakerLabelEditorProps {
  /** Current speaker label for this segment */
  currentLabel: string;
  /** All available speaker labels in the session */
  availableLabels: string[];
  /** Called when a new label is selected */
  onSelect: (newLabel: string) => void;
  /** Called when editing is cancelled */
  onCancel: () => void;
}

/**
 * SpeakerLabelEditor - Speaker label inline editing component with dropdown
 *
 * Requirements:
 * - 2.8: Click on speaker label shows dropdown with existing labels from the session
 * - 2.9: When no speaker identification info (no speakerLabel on any segment), hide the edit UI
 * - 2.10: On speaker change confirmation, record Correction with before/after speaker
 * - 2.11: Cancel reverts to original speaker
 */
export function SpeakerLabelEditor({
  currentLabel,
  availableLabels,
  onSelect,
  onCancel,
}: SpeakerLabelEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleToggleDropdown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsOpen((prev) => !prev);
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        setIsOpen(false);
        onCancel();
        buttonRef.current?.focus();
      }
    },
    [isOpen, onCancel]
  );

  const handleSelectLabel = useCallback(
    (label: string) => {
      setIsOpen(false);
      if (label !== currentLabel) {
        onSelect(label);
      } else {
        // Same label selected = no change, treat as cancel
        onCancel();
      }
    },
    [currentLabel, onSelect, onCancel]
  );

  const handleLabelKeyDown = useCallback(
    (e: React.KeyboardEvent, label: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSelectLabel(label);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        onCancel();
        buttonRef.current?.focus();
      }
    },
    [handleSelectLabel, onCancel]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        onCancel();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onCancel]);

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggleDropdown}
        onKeyDown={handleKeyDown}
        aria-label={`話者ラベル: ${currentLabel}。クリックして変更`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded whitespace-nowrap cursor-pointer hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-colors"
      >
        {currentLabel}
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="話者ラベル選択"
          className="absolute z-50 mt-1 left-0 min-w-[120px] bg-white border border-gray-200 rounded-md shadow-lg py-1"
        >
          {availableLabels.map((label) => (
            <div
              key={label}
              role="option"
              aria-selected={label === currentLabel}
              tabIndex={0}
              onClick={() => handleSelectLabel(label)}
              onKeyDown={(e) => handleLabelKeyDown(e, label)}
              className={`px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                label === currentLabel
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
