export class TurnState {
  current = 0;
  stopped = new Set();
  accepts(turn) {
    if (!Number.isInteger(turn) || this.stopped.has(turn) || turn < this.current) return false;
    this.current = Math.max(this.current, turn);
    return true;
  }
  stop(turn) {
    if (!Number.isInteger(turn) || turn < this.current) return false;
    this.stopped.add(turn);
    this.current = Math.max(this.current, turn);
    return true;
  }
  isCurrent(turn) {
    return turn === this.current && !this.stopped.has(turn);
  }
}
