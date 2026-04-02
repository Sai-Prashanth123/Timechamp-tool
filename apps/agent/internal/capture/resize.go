package capture

import (
	"bytes"
	"image"
	"image/draw"
	"image/jpeg"
)

const (
	maxDimension  = 1280
	jpegQuality   = 60
)

// resizeAndEncode scales img down so that neither dimension exceeds maxDimension,
// preserving the aspect ratio, then JPEG-encodes the result at jpegQuality.
// If the image already fits within maxDimension x maxDimension it is encoded as-is.
// The encoded bytes are returned in a new buffer.
func resizeAndEncode(img image.Image) ([]byte, error) {
	src := img.Bounds()
	w := src.Dx()
	h := src.Dy()

	// Compute target dimensions, preserving aspect ratio.
	tw, th := w, h
	if w > maxDimension || h > maxDimension {
		if w >= h {
			tw = maxDimension
			th = (h * maxDimension) / w
		} else {
			th = maxDimension
			tw = (w * maxDimension) / h
		}
	}

	// Only allocate + scale when a resize is actually needed.
	var out image.Image
	if tw == w && th == h {
		out = img
	} else {
		dst := image.NewNRGBA(image.Rect(0, 0, tw, th))
		// Use nearest-neighbour scaling via the stdlib draw package.
		// It is fast and avoids an external dependency; quality is acceptable
		// for workforce-monitoring screenshots at 1280px.
		scaleNearest(dst, img, tw, th, w, h)
		out = dst
	}

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: jpegQuality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// scaleNearest performs a simple nearest-neighbour downscale from src (w×h) into dst (tw×th).
func scaleNearest(dst draw.Image, src image.Image, tw, th, w, h int) {
	srcBounds := src.Bounds()
	x0 := srcBounds.Min.X
	y0 := srcBounds.Min.Y

	for y := range th {
		// Map destination row → source row
		sy := y0 + (y*h)/th
		for x := range tw {
			// Map destination column → source column
			sx := x0 + (x*w)/tw
			dst.Set(x, y, src.At(sx, sy))
		}
	}
}
