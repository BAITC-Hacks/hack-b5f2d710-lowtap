import { memo, useEffect, useId, useRef } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

/** Stable positions keep the illustration still when the scenario or viewport updates. */
function randomSequence(seed: number) {
  let value = seed
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

/** Repeat only the shapes crossing a tile edge, so no grove or canopy gets cut in half. */
function wrapTileEdges<T extends { x: number; y: number }>(items: T[], margin: number): T[] {
  return items.flatMap((item) => {
    const offsetsX = [0]
    const offsetsY = [0]
    if (item.x < margin) offsetsX.push(760)
    if (item.x > 760 - margin) offsetsX.push(-760)
    if (item.y < margin) offsetsY.push(660)
    if (item.y > 660 - margin) offsetsY.push(-660)
    return offsetsX.flatMap((x) => offsetsY.map((y) => ({ ...item, x: item.x + x, y: item.y + y })))
  })
}

const random = randomSequence(7241)
const groves = Array.from({ length: 44 }, () => ({
  x: random() * 760,
  y: random() * 660,
  rx: 18 + random() * 66,
  ry: 12 + random() * 43,
  rotation: random() * 180,
  shade: Math.floor(random() * 3),
}))
const trees = Array.from({ length: 180 }, (_, i) => {
  // Some trees share a grove; the rest form loose, irregular groups between clearings.
  const grove = groves[i % groves.length]
  const clustered = i % 3 !== 0
  return {
    x: clustered ? (grove.x + (random() - 0.5) * grove.rx * 1.65 + 760) % 760 : random() * 760,
    y: clustered ? (grove.y + (random() - 0.5) * grove.ry * 1.65 + 660) % 660 : random() * 660,
    scale: 0.48 + random() * 0.48,
    kind: Math.floor(random() * 3),
    opacity: 0.6 + random() * 0.32,
  }
}).sort((a, b) => a.y - b.y)
const grass = Array.from({ length: 145 }, () => ({
  x: random() * 760,
  y: random() * 660,
  scale: 0.45 + random() * 0.9,
  rotation: random() * 90,
}))
const seamlessGroves = wrapTileEdges(groves, 90)
const seamlessTrees = wrapTileEdges(trees, 36).sort((a, b) => a.y - b.y)
const seamlessGrass = wrapTileEdges(grass, 18)

const river = 'M 120,-160 C 135,-80 161,-44 196,15 C 230,69 247,122 207,163 C 172,199 132,203 128,254 C 123,304 97,318 59,302 C 11,280 -20,326 -79,362 M 617,433 C 661,478 633,529 687,544 C 736,558 775,558 794,609 C 812,657 767,681 783,724 C 799,767 866,766 884,814 C 900,859 950,877 985,907 C 1039,953 1064,997 1100,1090'

/** Decorative surroundings only; all district shapes and their interactions stay above it. */
const MapLandscape = memo(function MapLandscape({ width, height }: { width: number; height: number }) {
  const id = `landscape-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const treeId = (kind: number) => `${id}-tree-${kind}`

  return (
    <g data-testid="map-landscape" pointerEvents="none" aria-hidden="true" transform={`scale(${width / 1000} ${height / 900})`}>
      <defs>
        <linearGradient id={`${id}-water`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#91cdea" />
          <stop offset="1" stopColor="#77c1e5" />
        </linearGradient>
        <g id={treeId(0)}>
          <ellipse cx="4" cy="4" rx="9" ry="3.8" fill="#7b9c62" opacity="0.2" />
          <path d="M-7-6C-13-11-9-22-5-23C-7-33 4-36 7-25C14-20 13-8 7-5C3 0-3 0-7-6Z" fill="#74b778" />
          <path d="M-6-9C-10-15-5-20-3-20C-5-27 0-31 2-27C-1-19 0-10-1-3C-3-3-5-5-6-9Z" fill="#95c68a" opacity="0.65" />
          <path d="M0 6V-21M0-5L-5-10M0-9L5-15" fill="none" stroke="#5a8b65" strokeWidth="1.6" strokeLinecap="round" />
        </g>
        <g id={treeId(1)}>
          <ellipse cx="4" cy="4" rx="8" ry="3.3" fill="#7b9c62" opacity="0.18" />
          <path d="M0-31C4-30 4-24 7-21C8-17 7-15 10-11C13-4 6 0 0-1C-7 1-12-5-8-11C-7-16-8-17-5-21C-4-25-4-30 0-31Z" fill="#8bbb72" />
          <path d="M0-29C-5-19-2-10-2-2C-9-1-11-7-7-12C-7-18-5-19-4-22C-4-25-3-28 0-29Z" fill="#a7cb86" opacity="0.7" />
          <path d="M0 6V-20M0-5L-4-9M0-10L4-14" fill="none" stroke="#6b9466" strokeWidth="1.5" strokeLinecap="round" />
        </g>
        <g id={treeId(2)}>
          <ellipse cx="4" cy="4" rx="10" ry="3.8" fill="#7b9c62" opacity="0.18" />
          <path d="M-9-6C-15-10-11-20-5-21C-7-29 5-32 8-23C15-21 16-11 10-8C9-1-3 1-9-6Z" fill="#70ab70" />
          <path d="M-8-8C-13-12-9-19-4-19C-5-25 1-29 3-25C0-18-1-10 0-3C-3-3-6-4-8-8Z" fill="#96c186" opacity="0.65" />
          <path d="M0 6V-19M0-5L-5-10M0-9L5-13" fill="none" stroke="#527f5d" strokeWidth="1.6" strokeLinecap="round" />
        </g>
        <pattern id={`${id}-terrain`} width="760" height="660" patternUnits="userSpaceOnUse">
          <rect width="760" height="660" fill="#c9dfa8" />
          {seamlessGroves.map((grove, i) => (
            <ellipse
              key={`grove-${i}`}
              cx={grove.x}
              cy={grove.y}
              rx={grove.rx}
              ry={grove.ry}
              transform={`rotate(${grove.rotation} ${grove.x} ${grove.y})`}
              fill={['#b4d38f', '#dce8b6', '#a9cb86'][grove.shade]}
              opacity={grove.shade === 2 ? 0.3 : 0.54}
            />
          ))}
          {seamlessGrass.map((tuft, i) => (
            <g key={`grass-${i}`} transform={`translate(${tuft.x} ${tuft.y}) rotate(${tuft.rotation}) scale(${tuft.scale})`} opacity="0.36">
              <ellipse rx="3.5" ry="6" fill="#a2c47e" />
              <ellipse cx="6" cy="5" rx="2" ry="3.5" fill="#b0cc84" />
            </g>
          ))}
          {seamlessTrees.map((tree, i) => (
            <use
              key={`tree-${i}`}
              href={`#${treeId(tree.kind)}`}
              transform={`translate(${tree.x} ${tree.y}) scale(${tree.scale})`}
              opacity={tree.opacity}
            />
          ))}
        </pattern>
        <pattern id={`${id}-trails`} width="1280" height="1120" patternUnits="userSpaceOnUse" x="-150" y="-120">
          <g fill="none" stroke="#f6f5d9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M-70 120C99 115 80 224 213 219S382 87 550 126S728 272 890 209S1102 123 1350 217M-30 710C131 617 218 764 348 698S477 582 637 636S853 809 1003 703S1179 613 1340 687" strokeWidth="4.8" opacity="0.9" />
            <path d="M117-55C83 147 278 254 215 454S110 731 184 925S240 1132 178 1180M840-70C944 139 795 268 852 457S977 730 894 904S827 1091 907 1190" strokeWidth="4.1" opacity="0.8" />
            <path d="M-55 426C117 482 131 370 307 400S450 535 609 448S788 391 929 447S1118 480 1315 393M-24 966C138 882 243 1006 394 934S615 885 767 953S1092 1039 1302 932" strokeWidth="2" opacity="0.76" />
            <path d="M448-42C404 108 480 197 423 310S420 488 456 605S371 833 435 977S509 1105 480 1170M1130-15C1083 152 1169 265 1103 390S1139 588 1100 726S1046 944 1139 1146" strokeWidth="1.8" opacity="0.7" />
          </g>
        </pattern>
      </defs>

      {/* One viewport of overscan on every side remains illustrated during pan and zoom. */}
      <rect x="-1000" y="-900" width="3000" height="2700" fill={`url(#${id}-terrain)`} />
      <rect x="-1000" y="-900" width="3000" height="2700" fill={`url(#${id}-trails)`} />

      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={river} stroke="#deebbd" strokeWidth="53" />
        <path d={river} stroke="#aed9df" strokeWidth="40" />
        <path d={river} stroke={`url(#${id}-water)`} strokeWidth="30" />
        <path d={river} stroke="#a3daf0" strokeWidth="5" opacity="0.48" />
      </g>

      <g fill="#83c7e4" stroke="#b9dcb4" strokeWidth="4" strokeLinejoin="round">
        <path d="M936 215C949 204 965 218 971 214C987 205 998 220 990 235C986 246 976 245 972 258C966 277 947 276 942 264C937 258 923 267 921 253C918 240 930 233 936 215Z" />
        <path d="M889 334C910 326 920 341 934 340C953 340 960 359 953 373C949 380 952 393 940 397C923 406 916 387 901 384C884 382 881 372 869 364C856 353 870 338 889 334Z" />
        <path d="M110 705C122 694 132 704 144 699C160 694 171 707 169 719C168 730 155 729 150 739C143 747 130 744 126 737C114 741 104 733 105 724C100 719 103 710 110 705Z" />
        <path d="M652 815C665 807 668 813 679 813C688 808 699 817 697 827C702 840 688 843 680 838C670 847 655 840 656 833C645 832 646 821 652 815Z" />
        <path d="M963 611C973 602 978 609 988 604C1002 601 1008 613 1002 624C998 636 984 631 979 640C968 647 955 638 960 627C953 621 956 615 963 611Z" />
      </g>

      {/* A few larger paths tie the surrounding illustration together around the city. */}
      <g fill="none" stroke="#fffde9" strokeLinecap="round" opacity="0.85">
        <path d="M-30 48C48 122 115 89 177 154S272 224 350 252M-35 409C62 378 44 473 117 501S151 615 221 646M688 520C735 489 794 456 843 479S930 551 1032 536M194 930C242 824 349 853 361 767M595 783C681 784 688 726 747 721S898 676 1018 715" strokeWidth="4" />
        <path d="M67-20C95 51 73 127 101 174S64 254 65 275M774-20C779 61 719 106 727 190M850 948C827 867 737 858 716 804M1038 117C937 107 918 173 854 191S763 228 743 280" strokeWidth="2.2" />
      </g>
    </g>
  )
})

/**
 * The landscape area in 1000×900 map units: the viewport plus the furthest pan/zoom-out
 * reach of useMapNavigation (0.6 of the viewport on every side).
 */
const AREA = { x: -600, y: -540, width: 2200, height: 1980 }

let raster: Promise<HTMLCanvasElement> | null = null

/**
 * Rasterize the illustration once per page: ~900 SVG nodes with patterns are far too heavy
 * to repaint on every zoom frame, while a bitmap costs one texture draw.
 */
function landscapeRaster(): Promise<HTMLCanvasElement> {
  raster ??= new Promise<string>((resolve) => {
    // flushSync outside React's own render/commit phase.
    setTimeout(() => {
      const host = document.createElement('div')
      const root = createRoot(host)
      flushSync(() =>
        root.render(
          <svg width={AREA.width} height={AREA.height} viewBox={`${AREA.x} ${AREA.y} ${AREA.width} ${AREA.height}`}>
            <MapLandscape width={1000} height={900} />
          </svg>,
        ),
      )
      const markup = new XMLSerializer().serializeToString(host.firstElementChild!)
      root.unmount()
      resolve(markup)
    })
  })
    .then(async (markup) => {
      const image = new Image()
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
      await image.decode()
      const density = Math.min(1.5, 1.2 * (window.devicePixelRatio || 1))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(AREA.width * density)
      canvas.height = Math.round(AREA.height * density)
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      return canvas
    })
    .catch((error: unknown) => {
      raster = null
      throw error
    })
  return raster
}

/** Decorative surroundings as a bitmap, stretched to the map box like the vector original. */
export function MapLandscapeImage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let alive = true
    landscapeRaster()
      .then((source) => {
        const canvas = canvasRef.current
        if (!alive || !canvas) return
        canvas.width = source.width
        canvas.height = source.height
        canvas.getContext('2d')!.drawImage(source, 0, 0)
        canvas.style.opacity = '1'
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      data-testid="map-landscape"
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{
        left: `${(AREA.x / 1000) * 100}%`,
        top: `${(AREA.y / 900) * 100}%`,
        width: `${(AREA.width / 1000) * 100}%`,
        height: `${(AREA.height / 900) * 100}%`,
        opacity: 0,
        transition: 'opacity 200ms ease-out',
      }}
    />
  )
}
