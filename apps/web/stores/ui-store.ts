"use client";

import { create } from "zustand";

type UIState = {
  sidebarOpen: boolean;
  mobileNavOpen: boolean;
  activeModal: "product" | "supplier" | null;
  filters: {
    productsSearch: string;
    suppliersSearch: string;
    customersSearch: string;
    productsShowDeleted: boolean;
    suppliersShowDeleted: boolean;
    customersShowDeleted: boolean;
  };
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleMobileNav: () => void;
  setMobileNavOpen: (open: boolean) => void;
  setActiveModal: (modal: UIState["activeModal"]) => void;
  setFilter: (
    key: keyof UIState["filters"],
    value: string | boolean,
  ) => void;
};

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  mobileNavOpen: false,
  activeModal: null,
  filters: {
    productsSearch: "",
    suppliersSearch: "",
    customersSearch: "",
    productsShowDeleted: false,
    suppliersShowDeleted: false,
    customersShowDeleted: false,
  },
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleMobileNav: () => set((state) => ({ mobileNavOpen: !state.mobileNavOpen })),
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  setActiveModal: (activeModal) => set({ activeModal }),
  setFilter: (key, value) =>
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    })),
}));
