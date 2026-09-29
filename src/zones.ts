import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts'

export interface Zone {
  from: Time
  to: Time | null // null = strekker seg til høyre kant
  top: number
  bottom: number
  color: string
}

// Tegner rektangler (f.eks. fair value gaps) bak lysene
export class ZonesPrimitive implements ISeriesPrimitive<Time> {
  private zones: Zone[] = []
  private chart: IChartApi | null = null
  private series: ISeriesApi<SeriesType> | null = null
  private requestUpdate: (() => void) | null = null

  private readonly view: IPrimitivePaneView = {
    zOrder: () => 'bottom',
    renderer: () => this.renderer,
  }

  private readonly renderer: IPrimitivePaneRenderer = {
    draw: (target) => {
      const chart = this.chart
      const series = this.series
      if (!chart || !series) return
      target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
        const ts = chart.timeScale()
        for (const z of this.zones) {
          const x1 = ts.timeToCoordinate(z.from)
          const x2 = z.to === null ? bitmapSize.width / hr : ts.timeToCoordinate(z.to)
          const y1 = series.priceToCoordinate(z.top)
          const y2 = series.priceToCoordinate(z.bottom)
          if (x1 === null || x2 === null || y1 === null || y2 === null) continue
          ctx.fillStyle = z.color
          ctx.fillRect(
            Math.round(x1 * hr),
            Math.round(Math.min(y1, y2) * vr),
            Math.max(1, Math.round((x2 - x1) * hr)),
            Math.max(1, Math.round(Math.abs(y2 - y1) * vr)),
          )
        }
      })
    },
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.chart = chart
    this.series = series
    this.requestUpdate = requestUpdate
  }

  detached() {
    this.chart = null
    this.series = null
    this.requestUpdate = null
  }

  paneViews() {
    return [this.view]
  }

  setZones(zones: Zone[]) {
    this.zones = zones
    this.requestUpdate?.()
  }
}
