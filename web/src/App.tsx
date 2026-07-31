import { useEffect, useState } from "react";
import AccountMenu from "./components/AccountMenu";
import { AuthProvider } from "./lib/auth";
import type { Product } from "./lib/rank";
import { StarsProvider } from "./lib/stars";
import { useStars } from "./lib/stars-context";
import Browse from "./pages/Browse";
import Starred from "./pages/Starred";
import "./App.css";

type Route = "browse" | "starred";

function useHashRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash.startsWith("#/starred") ? "starred" : "browse";
}

export default function App() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/products.json")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load products (${res.status})`);
        return res.json() as Promise<Product[]>;
      })
      .then((data) => {
        if (!cancelled) setProducts(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthProvider>
      <StarsProvider>
        <Shell products={products} error={error} />
      </StarsProvider>
    </AuthProvider>
  );
}

function Shell({
  products,
  error,
}: {
  products: Product[] | null;
  error: string | null;
}) {
  const route = useHashRoute();
  const { count } = useStars();

  useEffect(() => {
    document.title =
      route === "starred"
        ? "Starred — PER·KCAL"
        : "PER·KCAL — Tesco veggie protein density";
  }, [route]);

  return (
    <div className="shell">
      <nav className="topbar" aria-label="Primary">
        <a className="wordmark" href="#/">
          PER<span className="dot">·</span>KCAL
        </a>
        <div className="navlinks">
          <a className={route === "browse" ? "navlink active" : "navlink"} href="#/">
            Browse
          </a>
          <a
            className={route === "starred" ? "navlink active" : "navlink"}
            href="#/starred"
            aria-current={route === "starred" ? "page" : undefined}
          >
            Starred
            {count > 0 && <span className="badge">{count}</span>}
          </a>
        </div>
        <AccountMenu />
      </nav>

      {route === "starred" ? (
        <Starred products={products} error={error} />
      ) : (
        <Browse products={products} error={error} />
      )}
    </div>
  );
}
