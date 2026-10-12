/**
 * ResponsiveLayout - レスポンシブレイアウトコンポーネント
 *
 * ビューポート幅に応じてレイアウトを切り替える:
 * - 768px未満: MobileUnsupported メッセージ表示
 * - 768px〜1023px: 上下分割レイアウト（タブレット向け簡易編集）
 * - 1024px以上: 左右分割レイアウト（デスクトップ向け全機能）
 *
 * TailwindCSS 4 レスポンシブプレフィックス（md: for 768px+, lg: for 1024px+）で実装。
 *
 * Requirements: 11.6
 */

import { type ReactNode } from 'react';
import { MobileUnsupported } from './MobileUnsupported';

export interface ResponsiveLayoutProps {
  /** 左側（デスクトップ）または上部（タブレット）に表示するコンテンツ */
  primary: ReactNode;
  /** 右側（デスクトップ）または下部（タブレット）に表示するコンテンツ */
  secondary: ReactNode;
}

export function ResponsiveLayout({ primary, secondary }: ResponsiveLayoutProps) {
  return (
    <>
      {/* Mobile: unsupported message (below 768px) */}
      <MobileUnsupported />

      {/* Tablet & Desktop: content layout (768px+) */}
      <div className="hidden md:flex md:flex-col lg:flex-row h-full min-h-0">
        {/* Primary panel: top on tablet, left on desktop */}
        <div className="md:h-1/2 lg:h-full lg:w-1/2 min-h-0 overflow-auto">
          {primary}
        </div>

        {/* Secondary panel: bottom on tablet, right on desktop */}
        <div className="md:h-1/2 lg:h-full lg:w-1/2 min-h-0 overflow-auto">
          {secondary}
        </div>
      </div>
    </>
  );
}
