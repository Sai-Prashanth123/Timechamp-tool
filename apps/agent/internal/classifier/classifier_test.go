package classifier

import "testing"

func TestClassifierCache(t *testing.T) {
	rules := DefaultRules

	cache := NewCache(512)

	// First call — cache miss, regex runs.
	cat1 := cache.Classify("chrome", "GitHub", "", rules)
	if cat1 == "" {
		t.Fatal("expected non-empty category for chrome/GitHub")
	}

	// Same inputs — should hit cache and return identical result.
	cat2 := cache.Classify("chrome", "GitHub", "", rules)
	if cat2 != cat1 {
		t.Errorf("cache returned different result: %s vs %s", cat1, cat2)
	}

	// Eviction: fill past maxSize — oldest entry should be evicted.
	smallCache := NewCache(2)
	smallCache.Classify("app1", "title1", "", rules)
	smallCache.Classify("app2", "title2", "", rules)
	smallCache.Classify("app3", "title3", "", rules) // evicts app1|title1
	if _, ok := smallCache.entries["app1|title1"]; ok {
		t.Error("expected app1|title1 to be evicted after capacity exceeded")
	}
	// app2 and app3 should still be present.
	if _, ok := smallCache.entries["app2|title2"]; !ok {
		t.Error("expected app2|title2 to still be in cache")
	}
}
