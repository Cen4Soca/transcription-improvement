import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpeakerLabelEditor } from './SpeakerLabelEditor';

describe('SpeakerLabelEditor', () => {
  const defaultProps = {
    currentLabel: 'spk_0',
    availableLabels: ['spk_0', 'spk_1', 'spk_2'],
    onSelect: vi.fn(),
    onCancel: vi.fn(),
  };

  describe('話者ラベルクリックでドロップダウン表示 (Requirement 2.8)', () => {
    it('displays current label as a button', () => {
      render(<SpeakerLabelEditor {...defaultProps} />);

      const button = screen.getByRole('button', { name: /話者ラベル: spk_0/ });
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent('spk_0');
    });

    it('shows dropdown with available labels on click', async () => {
      const user = userEvent.setup();
      render(<SpeakerLabelEditor {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /話者ラベル: spk_0/ }));

      const listbox = screen.getByRole('listbox', { name: '話者ラベル選択' });
      expect(listbox).toBeInTheDocument();

      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(3);
      expect(options[0]).toHaveTextContent('spk_0');
      expect(options[1]).toHaveTextContent('spk_1');
      expect(options[2]).toHaveTextContent('spk_2');
    });

    it('marks current label as selected in dropdown', async () => {
      const user = userEvent.setup();
      render(<SpeakerLabelEditor {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /話者ラベル: spk_0/ }));

      const currentOption = screen.getByRole('option', { name: 'spk_0' });
      expect(currentOption).toHaveAttribute('aria-selected', 'true');

      const otherOption = screen.getByRole('option', { name: 'spk_1' });
      expect(otherOption).toHaveAttribute('aria-selected', 'false');
    });

    it('toggles dropdown on repeated clicks', async () => {
      const user = userEvent.setup();
      render(<SpeakerLabelEditor {...defaultProps} />);

      const button = screen.getByRole('button', { name: /話者ラベル: spk_0/ });

      await user.click(button);
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      await user.click(button);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('opens dropdown with Enter key', async () => {
      const user = userEvent.setup();
      render(<SpeakerLabelEditor {...defaultProps} />);

      const button = screen.getByRole('button', { name: /話者ラベル: spk_0/ });
      button.focus();
      await user.keyboard('{Enter}');

      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('opens dropdown with Space key', async () => {
      const user = userEvent.setup();
      render(<SpeakerLabelEditor {...defaultProps} />);

      const button = screen.getByRole('button', { name: /話者ラベル: spk_0/ });
      button.focus();
      await user.keyboard(' ');

      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
  });

  describe('ラベル選択 (Requirement 2.10)', () => {
    it('calls onSelect when a different label is chosen', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<SpeakerLabelEditor {...defaultProps} onSelect={onSelect} />);

      await user.click(screen.getByRole('button', { name: /話者ラベル: spk_0/ }));
      await user.click(screen.getByRole('option', { name: 'spk_1' }));

      expect(onSelect).toHaveBeenCalledWith('spk_1');
    });

    it('closes dropdown after selection', async () => {
      const user = userEvent.setup();
      render(<SpeakerLabelEditor {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /話者ラベル: spk_0/ }));
      await user.click(screen.getByRole('option', { name: 'spk_1' }));

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('calls onCancel when same label is selected (no change)', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      const onSelect = vi.fn();
      render(
        <SpeakerLabelEditor
          {...defaultProps}
          onSelect={onSelect}
          onCancel={onCancel}
        />
      );

      await user.click(screen.getByRole('button', { name: /話者ラベル: spk_0/ }));
      await user.click(screen.getByRole('option', { name: 'spk_0' }));

      expect(onCancel).toHaveBeenCalled();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('selects label with Enter key', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<SpeakerLabelEditor {...defaultProps} onSelect={onSelect} />);

      await user.click(screen.getByRole('button', { name: /話者ラベル: spk_0/ }));
      const option = screen.getByRole('option', { name: 'spk_2' });
      option.focus();
      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith('spk_2');
    });
  });

  describe('キャンセル操作 (Requirement 2.11)', () => {
    it('calls onCancel on Escape key when dropdown is open', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      render(<SpeakerLabelEditor {...defaultProps} onCancel={onCancel} />);

      const button = screen.getByRole('button', { name: /話者ラベル: spk_0/ });
      await user.click(button);
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(onCancel).toHaveBeenCalled();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('calls onCancel when clicking outside the dropdown', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      render(
        <div>
          <SpeakerLabelEditor {...defaultProps} onCancel={onCancel} />
          <div data-testid="outside">Outside</div>
        </div>
      );

      await user.click(screen.getByRole('button', { name: /話者ラベル: spk_0/ }));
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      await user.click(screen.getByTestId('outside'));

      expect(onCancel).toHaveBeenCalled();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('アクセシビリティ', () => {
    it('has proper ARIA attributes on the button', () => {
      render(<SpeakerLabelEditor {...defaultProps} />);

      const button = screen.getByRole('button', { name: /話者ラベル: spk_0/ });
      expect(button).toHaveAttribute('aria-haspopup', 'listbox');
      expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('sets aria-expanded to true when dropdown is open', async () => {
      const user = userEvent.setup();
      render(<SpeakerLabelEditor {...defaultProps} />);

      const button = screen.getByRole('button', { name: /話者ラベル: spk_0/ });
      await user.click(button);

      expect(button).toHaveAttribute('aria-expanded', 'true');
    });
  });
});
