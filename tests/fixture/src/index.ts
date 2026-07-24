import type { WidgetId } from './util/index.js'

export type { WidgetId } from './util/index.js'

/** Build a widget id from a raw string. */
export function makeWidget(raw: string): WidgetId {
  return `w_${raw}`
}
