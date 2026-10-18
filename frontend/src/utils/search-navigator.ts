/**
 * SearchNavigator - 検索結果のナビゲーション管理クラス
 *
 * 検索一致結果間の「次へ」「前へ」移動を管理する。
 * 循環ナビゲーション: 最後→最初、最初→最後に折り返す。
 *
 * Requirements: 6.3, 6.5
 */
export class SearchNavigator {
  private currentIndex: number = -1;
  private matchCount: number = 0;

  /**
   * 一致件数を設定する。
   * 件数が変わった場合、currentIndexをリセットする。
   */
  setMatchCount(count: number): void {
    this.matchCount = count;
    if (count === 0) {
      this.currentIndex = -1;
    } else if (this.currentIndex >= count) {
      this.currentIndex = 0;
    }
  }

  /**
   * 次の一致箇所に移動する。
   * 最後の一致箇所では最初に折り返す（循環ナビゲーション）。
   * 一致件数が0の場合は-1を返す。
   *
   * Requirement 6.3
   */
  next(): number {
    if (this.matchCount === 0) {
      return -1;
    }

    this.currentIndex = (this.currentIndex + 1) % this.matchCount;
    return this.currentIndex;
  }

  /**
   * 前の一致箇所に移動する。
   * 最初の一致箇所では最後に折り返す（循環ナビゲーション）。
   * 一致件数が0の場合は-1を返す。
   *
   * Requirement 6.3
   */
  previous(): number {
    if (this.matchCount === 0) {
      return -1;
    }

    if (this.currentIndex <= 0) {
      this.currentIndex = this.matchCount - 1;
    } else {
      this.currentIndex = this.currentIndex - 1;
    }
    return this.currentIndex;
  }

  /**
   * ナビゲーション状態をリセットする。
   * 検索クリア時に使用する。
   *
   * Requirement 6.5
   */
  reset(): void {
    this.currentIndex = -1;
    this.matchCount = 0;
  }

  /**
   * 現在のインデックスを取得する。
   * -1は未選択状態を示す。
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * 現在の一致件数を取得する。
   */
  getMatchCount(): number {
    return this.matchCount;
  }
}
