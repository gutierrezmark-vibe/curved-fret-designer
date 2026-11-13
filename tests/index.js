// Lets `node --test tests/` work on Node 22+, where a bare directory argument
// is loaded as a module (this file) instead of being searched. Older Node
// versions search the directory and run *.test.mjs directly, skipping this.
import('./geometry.test.mjs');
