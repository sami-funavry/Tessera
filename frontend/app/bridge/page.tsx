import { redirect } from 'next/navigation';

// The bridge widget lives on the homepage (/#bridge anchor).
// Redirect /bridge so bookmarked URLs land correctly without a duplicate page.
export default function BridgePage() {
  redirect('/#bridge');
}
