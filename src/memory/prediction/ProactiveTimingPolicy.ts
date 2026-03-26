export interface ProactiveTimingDecision {
  allow: boolean;
  mode?: "inject" | "prefetch";
  depth?: 1 | 2;
}

export function proactivePolicy(
  nowUTC: number,
  lastMsgUTC: number,
  firstMsgUTC: number,
  lastTriggerUTC: number
): ProactiveTimingDecision {
  if (!isFiniteNumber(nowUTC) || !isFiniteNumber(lastMsgUTC) || !isFiniteNumber(firstMsgUTC)) {
    return { allow: false };
  }

  const deltaLast = nowUTC - lastMsgUTC;
  const span = Math.max(0, lastMsgUTC - firstMsgUTC);
  const deltaTrigger = isFiniteNumber(lastTriggerUTC) ? nowUTC - lastTriggerUTC : Number.POSITIVE_INFINITY;

  if (deltaTrigger < 120) return { allow: false };

  if (deltaLast <= 300) {
    return { allow: true, mode: "inject", depth: span <= 1200 ? 2 : 1 };
  }

  if (deltaLast <= 1800) {
    return { allow: true, mode: "prefetch", depth: 1 };
  }

  return { allow: false };
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}
