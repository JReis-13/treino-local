import Link from "next/link";
import { formatLocalDate } from "@/lib/dates";

export function ExerciseLoadRecords({ history }: { history: Array<{ sessionId: string; date: string; load: string }> }) {
  return <div className="detail-history-list">{history.map(item =>
    <Link href={`/history/session/?id=${encodeURIComponent(item.sessionId)}`} key={item.sessionId}>
      <span>{formatLocalDate(item.date)}</span><strong>{item.load}</strong>
    </Link>)}</div>;
}
