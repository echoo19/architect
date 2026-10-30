import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { Hero } from './components/Hero';

/** The home page: what Architect is, the downloads, and the walkthrough film. */
export function App() {
  return (
    <div id="top">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
      >
        Skip to the content
      </a>
      <Header page="home" />
      <main id="main">
        <Hero />
      </main>
      <Footer page="home" />
    </div>
  );
}
