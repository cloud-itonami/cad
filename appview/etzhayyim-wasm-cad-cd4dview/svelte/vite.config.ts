import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

function packageChunkName(id: string) {
	const marker = `${'/nodeModules/'}`;
	const start = id.indexOf(marker);
	if (start === -1) return null;
	const segment = id.slice(start + marker.length).split('/')[0];
	if (!segment) return null;
	if (segment.startsWith('.pnpm')) {
		const scoped = id.slice(start + marker.length).split('/nodeModules/')[1];
		if (!scoped) return 'vendor';
		const parts = scoped.split('/');
		return `pkg-${parts[0]?.replace('@', '').replace('/', '-')}`;
	}
	return `pkg-${segment.replace('@', '')}`;
}

export default defineConfig({
	plugins: [svelte()],
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes('nodeModules') && !id.includes('/packages/ts/')) return;
					if (id.includes('/packages/ts/design-system/') || id.includes('/packages/ts/design-system/')) {
						return 'etzhayyim-ui';
					}
					if (id.includes('/nodeModules/@threlte/') || id.includes('/nodeModules/three/')) {
						return 'threlte';
					}
					if (id.includes('/nodeModules/@connectrpc/') || id.includes('/nodeModules/@bufbuild/')) {
						return 'connect';
					}
					if (id.includes('/nodeModules/')) {
						return packageChunkName(id) ?? 'vendor';
					}
				}
			}
		}
	},
	ssr: {
		noExternal: ['@etzhayyim/design-system', '@etzhayyim/design-system']
	},
	server: {
		allowedHosts: true
	}
});
