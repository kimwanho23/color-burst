/** 타임어택 결과 판정: 이번 점수와 최고 기록(없으면 null)으로 신기록 여부와 결과 화면 문구. 0점은 기록이 아니다 */
export function taVerdict(score: number, best: number | null): { record: boolean; title: string; hint: string } {
  if (score <= 0 && !best) return { record: false, title: `${score}점`, hint: '원을 잡아 첫 기록을 세워 보세요' };
  if (!best) return { record: true, title: '신기록!', hint: '첫 기록이에요' };
  if (score > best) return { record: true, title: '신기록!', hint: `이전 최고 ${best}점` };
  return { record: false, title: `${score}점`, hint: `최고 기록 ${best}점` };
}
