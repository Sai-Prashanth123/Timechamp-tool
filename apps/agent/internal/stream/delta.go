package stream

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/jpeg"
)

const blockSize = 16 // 16×16 pixel blocks

// DeltaEncoder tracks the previous frame and encodes only changed blocks.
type DeltaEncoder struct {
	blockHashes []uint32
	gridW       int
	gridH       int
	imgW        int
	imgH        int
}

// NewDeltaEncoder creates a new DeltaEncoder.
func NewDeltaEncoder() *DeltaEncoder {
	return &DeltaEncoder{}
}

// Encode compares img against the previous frame.
// Returns (frameType, data, error).
// frameType is FrameTypeScreenFull or FrameTypeScreenDelta.
func (e *DeltaEncoder) Encode(img image.Image, jpegQuality int) (byte, []byte, error) {
	bounds := img.Bounds()
	w := bounds.Max.X - bounds.Min.X
	h := bounds.Max.Y - bounds.Min.Y

	// Reset encoder if dimensions changed
	if w != e.imgW || h != e.imgH {
		e.reset(w, h)
	}

	gridW := (w + blockSize - 1) / blockSize
	gridH := (h + blockSize - 1) / blockSize
	totalBlocks := gridW * gridH

	// Compute hashes for all blocks
	newHashes := make([]uint32, totalBlocks)
	for by := range gridH {
		for bx := range gridW {
			idx := by*gridW + bx
			newHashes[idx] = hashBlock(img, bounds.Min.X+bx*blockSize, bounds.Min.Y+by*blockSize)
		}
	}

	// First frame or after reset: send full frame
	if e.blockHashes == nil {
		e.blockHashes = newHashes
		e.gridW = gridW
		e.gridH = gridH
		data, err := encodeFullJPEG(img, jpegQuality)
		return FrameTypeScreenFull, data, err
	}

	// Count changed blocks
	changed := make([]bool, totalBlocks)
	changedCount := 0
	for i := range newHashes {
		if newHashes[i] != e.blockHashes[i] {
			changed[i] = true
			changedCount++
		}
	}

	// If >60% changed, send full frame
	if changedCount*100/totalBlocks > 60 {
		copy(e.blockHashes, newHashes)
		data, err := encodeFullJPEG(img, jpegQuality)
		return FrameTypeScreenFull, data, err
	}

	// Build delta payload
	// Format: [gridW uint16][gridH uint16][bitfield ceil(totalBlocks/8) bytes][for each changed block: jpeg_len uint16 + jpeg_bytes]
	bitfieldSize := (totalBlocks + 7) / 8
	bitfield := make([]byte, bitfieldSize)
	for i, c := range changed {
		if c {
			bitfield[i/8] |= 1 << uint(i%8)
		}
	}

	var buf bytes.Buffer
	// Write grid dimensions
	gridWb := make([]byte, 2)
	gridHb := make([]byte, 2)
	binary.BigEndian.PutUint16(gridWb, uint16(gridW))
	binary.BigEndian.PutUint16(gridHb, uint16(gridH))
	buf.Write(gridWb)
	buf.Write(gridHb)
	// Write bitfield
	buf.Write(bitfield)

	// Write JPEG data for each changed block
	for by := range gridH {
		for bx := range gridW {
			idx := by*gridW + bx
			if !changed[idx] {
				continue
			}
			blockData, err := encodeBlockJPEG(img, bounds.Min.X+bx*blockSize, bounds.Min.Y+by*blockSize, jpegQuality)
			if err != nil {
				continue
			}
			lenB := make([]byte, 2)
			binary.BigEndian.PutUint16(lenB, uint16(len(blockData)))
			buf.Write(lenB)
			buf.Write(blockData)
			e.blockHashes[idx] = newHashes[idx]
		}
	}

	return FrameTypeScreenDelta, buf.Bytes(), nil
}

func (e *DeltaEncoder) reset(w, h int) {
	e.blockHashes = nil
	e.imgW = w
	e.imgH = h
	e.gridW = 0
	e.gridH = 0
}

// hashBlock computes a simple hash for a 16×16 block.
func hashBlock(img image.Image, x, y int) uint32 {
	var sum uint32
	for dy := range blockSize {
		for dx := range blockSize {
			r, g, b, _ := img.At(x+dx, y+dy).RGBA()
			sum += (r>>8)*31 + (g>>8)*37 + (b>>8)*41
		}
	}
	return sum
}

// encodeFullJPEG encodes the entire image as JPEG.
func encodeFullJPEG(img image.Image, quality int) ([]byte, error) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// encodeBlockJPEG encodes a 16×16 block as JPEG.
func encodeBlockJPEG(img image.Image, x, y, quality int) ([]byte, error) {
	// Create a sub-image for the block
	type subImager interface {
		SubImage(r image.Rectangle) image.Image
	}
	if si, ok := img.(subImager); ok {
		block := si.SubImage(image.Rect(x, y, x+blockSize, y+blockSize))
		return encodeFullJPEG(block, quality)
	}
	// Fallback: copy pixels to RGBA
	rgba := image.NewRGBA(image.Rect(0, 0, blockSize, blockSize))
	for dy := range blockSize {
		for dx := range blockSize {
			rgba.Set(dx, dy, img.At(x+dx, y+dy))
		}
	}
	return encodeFullJPEG(rgba, quality)
}
