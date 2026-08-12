/**
 * Megumin Suite — frontend entry point.
 *
 * Everything visual in this build is the engine panel. The side panel, present
 * characters bar and block rendering land in later slices; they mount from here.
 */

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import { mountPanel } from './frontend/panel'

export function setup(ctx: SpindleFrontendContext) {
  const unmountPanel = mountPanel(ctx)

  return () => {
    unmountPanel()
    ctx.dom.cleanup()
  }
}
