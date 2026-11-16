import { useMemo } from 'react';
import { Layout } from './components/Layout';
import { EXAMPLE_PRESETS, loadPresets } from './lib/presets';
import { KitProvider } from './state/kit';
import { href, useRoute } from './state/router';
import { Home } from './tools/Home';
import { ImagesToPdfTool } from './tools/ImagesToPdfTool';
import { KitPage } from './tools/KitPage';
import { MergeExtractTool } from './tools/MergeExtractTool';
import { PdfCompressTool } from './tools/PdfCompressTool';
import { PhotoTool } from './tools/PhotoTool';
import { PresetsPage } from './tools/PresetsPage';

function Page() {
  const route = useRoute();
  const presetId = route.params.get('preset');
  // A "Use" link from the presets page carries the preset id in the address.
  const preset = useMemo(
    () => (presetId ? [...loadPresets(), ...EXAMPLE_PRESETS].find((p) => p.id === presetId) : undefined),
    [presetId],
  );

  switch (route.path) {
    case '':
      return <Home />;
    case 'photo':
      return <PhotoTool key={presetId ?? 'photo'} initialPreset={preset} />;
    case 'compress':
      return <PdfCompressTool key={presetId ?? 'compress'} initialPreset={preset} />;
    case 'images-to-pdf':
      return <ImagesToPdfTool />;
    case 'merge':
      return <MergeExtractTool />;
    case 'presets':
      return <PresetsPage />;
    case 'kit':
      return <KitPage />;
    default:
      return (
        <div>
          <h1 className="text-2xl font-semibold text-ink">Page not found</h1>
          <a href={href('')} className="mt-2 inline-block font-medium text-brand underline">
            Back to all tools
          </a>
        </div>
      );
  }
}

export function App() {
  return (
    <KitProvider>
      <Layout>
        <Page />
      </Layout>
    </KitProvider>
  );
}
