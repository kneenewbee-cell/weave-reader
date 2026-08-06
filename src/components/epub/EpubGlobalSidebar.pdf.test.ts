import { fireEvent, render, waitFor } from '@testing-library/svelte';

vi.mock('obsidian', async () => {
	return await vi.importActual<typeof import('../../tests/mocks/obsidian')>('../../tests/mocks/obsidian');
});

vi.mock('./BookshelfView.svelte', () => ({
	default: (_anchor: HTMLElement, _props: unknown) => undefined,
}));

import { App } from 'obsidian';
import EpubGlobalSidebar from './EpubGlobalSidebar.svelte';
import { epubActiveDocumentStore } from '../../stores/epub-active-document-store';

describe('EpubGlobalSidebar PDF mode', () => {
	afterEach(() => {
		epubActiveDocumentStore.clearActiveDocument();
		document.body.innerHTML = '';
		vi.restoreAllMocks();
	});

	it('shows PDF annotations in the annotation tab and navigates to the selected annotation', async () => {
		const onNavigateAnnotation = vi.fn();
		epubActiveDocumentStore.setActivePdfDocument({
			filePath: 'Books/demo.pdf',
			title: 'demo',
			currentPage: 1,
			pageCount: 3,
			progress: 33,
			thumbnails: [{ pageNumber: 1, image: 'data:image/png;base64,thumb' }],
			annotations: [
				{
					id: 'annotation-1',
					pageNumber: 2,
					kind: 'underline',
					color: '#0EA5E9',
					text: '重要定义',
					semanticId: 'definition',
					semanticLabel: '定义',
					semanticStyle: 'underline',
					createdAt: 123,
				},
			],
			onNavigateAnnotation,
		});

		const { container, getByRole, getByText } = render(EpubGlobalSidebar, {
			props: {
				app: new App(),
			},
		});

		const annotationTab = await waitFor(() => getByRole('button', { name: /标注/ }));
		expect(annotationTab).not.toBeDisabled();

		await fireEvent.click(annotationTab);

		expect(container.querySelector('.pdf-annotation-list')).toBeInTheDocument();
		expect(getByText('重要定义')).toBeInTheDocument();
		expect(getByText('定义')).toBeInTheDocument();
		expect(getByText('第 2 页')).toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: /第 2 页.*重要定义/ }));

		expect(onNavigateAnnotation).toHaveBeenCalledWith('annotation-1');
	});
});
