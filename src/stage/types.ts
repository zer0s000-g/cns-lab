/** Stage types, kept free of three.js so pages can import them without loading the 3D chunk. */
export interface Shot {
  position: [number, number, number]
  target: [number, number, number]
  fov?: number
}

export type Quality = 'high' | 'medium' | 'low'
