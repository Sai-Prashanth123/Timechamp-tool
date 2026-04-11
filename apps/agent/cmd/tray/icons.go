//go:build windows

package main

import (
	"bytes"
	"encoding/binary"
)

// makeCircleICO generates a 16x16 32bpp ARGB Windows .ico file containing a
// filled circle of the given color on a transparent background. Returned
// bytes can be passed directly to systray.SetIcon on Windows.
//
// Generating icons in code avoids shipping binary asset files and keeps the
// tray binary self-contained. Sizes/format are fixed for the system tray.
func makeCircleICO(r, g, b byte) []byte {
	const size = 16
	const pixelSize = size * size * 4 // 32bpp BGRA
	const maskSize = size * size / 8  // 1bpp AND mask
	const biSize = 40                 // BITMAPINFOHEADER size
	const dataSize = biSize + pixelSize + maskSize

	var buf bytes.Buffer

	// ICONDIR (6 bytes)
	binary.Write(&buf, binary.LittleEndian, uint16(0)) // reserved
	binary.Write(&buf, binary.LittleEndian, uint16(1)) // type = 1 (icon)
	binary.Write(&buf, binary.LittleEndian, uint16(1)) // image count

	// ICONDIRENTRY (16 bytes)
	buf.WriteByte(size)                                      // width
	buf.WriteByte(size)                                      // height
	buf.WriteByte(0)                                         // colorCount (0 = >256)
	buf.WriteByte(0)                                         // reserved
	binary.Write(&buf, binary.LittleEndian, uint16(1))       // planes
	binary.Write(&buf, binary.LittleEndian, uint16(32))      // bits per pixel
	binary.Write(&buf, binary.LittleEndian, uint32(dataSize)) // bytes in resource
	binary.Write(&buf, binary.LittleEndian, uint32(22))      // offset = 6 + 16

	// BITMAPINFOHEADER (40 bytes) — height is doubled per ICO spec.
	binary.Write(&buf, binary.LittleEndian, uint32(biSize))
	binary.Write(&buf, binary.LittleEndian, int32(size))
	binary.Write(&buf, binary.LittleEndian, int32(size*2))
	binary.Write(&buf, binary.LittleEndian, uint16(1))
	binary.Write(&buf, binary.LittleEndian, uint16(32))
	binary.Write(&buf, binary.LittleEndian, uint32(0)) // BI_RGB
	binary.Write(&buf, binary.LittleEndian, uint32(pixelSize))
	binary.Write(&buf, binary.LittleEndian, int32(0))
	binary.Write(&buf, binary.LittleEndian, int32(0))
	binary.Write(&buf, binary.LittleEndian, uint32(0))
	binary.Write(&buf, binary.LittleEndian, uint32(0))

	// Pixel data — bottom-up rows, BGRA, circle of radius ~7 centered.
	const cx, cy = 7.5, 7.5
	const radiusSq = 7.0 * 7.0
	for y := 0; y < size; y++ {
		// DIBs are stored bottom-up; iterate flipY for natural top-down circle.
		flipY := float64(size - 1 - y)
		for x := 0; x < size; x++ {
			dx := float64(x) - cx
			dy := flipY - cy
			if dx*dx+dy*dy <= radiusSq {
				buf.WriteByte(b)
				buf.WriteByte(g)
				buf.WriteByte(r)
				buf.WriteByte(255)
			} else {
				buf.WriteByte(0)
				buf.WriteByte(0)
				buf.WriteByte(0)
				buf.WriteByte(0) // transparent
			}
		}
	}

	// AND mask: all zero (alpha channel handles transparency for 32bpp).
	buf.Write(make([]byte, maskSize))
	return buf.Bytes()
}

var (
	iconGreen  = makeCircleICO(0x22, 0xc5, 0x5e) // healthy
	iconYellow = makeCircleICO(0xea, 0xb3, 0x08) // sync retrying
	iconRed    = makeCircleICO(0xef, 0x44, 0x44) // API unreachable / never synced
)
