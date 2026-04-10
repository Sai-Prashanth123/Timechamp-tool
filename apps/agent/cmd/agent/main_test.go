package main

import "testing"

func TestMedianUint32(t *testing.T) {
	cases := []struct {
		in   [3]uint32
		want uint32
	}{
		{[3]uint32{1, 2, 3}, 2},
		{[3]uint32{100, 1, 2}, 2},    // spike filtered
		{[3]uint32{0, 86400, 5}, 5},  // 24h spike filtered
		{[3]uint32{10, 10, 10}, 10},
		{[3]uint32{3, 1, 2}, 2},      // unsorted
		{[3]uint32{0, 0, 0}, 0},      // all zero (user active)
	}
	for _, c := range cases {
		got := medianUint32(c.in)
		if got != c.want {
			t.Errorf("medianUint32(%v) = %d, want %d", c.in, got, c.want)
		}
	}
}
