import type { DeepReadonly } from "./types";

function freezeValue(value: unknown, seen: WeakSet<object>): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      freezeValue(descriptor.value, seen);
    }
  }
  if (!Object.isFrozen(value)) Object.freeze(value);
}

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  freezeValue(value, new WeakSet<object>());
  return value as DeepReadonly<T>;
}

export function isDeeplyFrozen(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  if (seen.has(value)) return true;
  seen.add(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value") && !isDeeplyFrozen(descriptor.value, seen)) {
      return false;
    }
  }
  return true;
}

export function assertFrozen(value: unknown, label = "value"): void {
  if (!isDeeplyFrozen(value)) throw new TypeError(label + " must be a deeply frozen value");
}
