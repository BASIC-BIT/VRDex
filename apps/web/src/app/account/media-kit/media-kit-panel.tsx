"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowDown, ArrowUp, ImagePlus, RotateCcw, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";

import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";

type MediaAsset = {
  assetId: string;
  state: "active" | "deleted";
  label?: string;
  caption?: string;
  altText?: string;
  credit?: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  featured: boolean;
  imageUrl?: string;
};

type MediaProfile = {
  profileId: string;
  profileType: "person" | "community";
  slug: string;
  displayName: string;
  assets: MediaAsset[];
};

type EditorActions = {
  upload: (
    profileId: string,
    file: File,
    metadata: Pick<MediaAsset, "label" | "altText" | "credit">,
  ) => Promise<void>;
  saveMetadata: (profileId: string, asset: MediaAsset) => Promise<void>;
  reorder: (profileId: string, assetIds: string[]) => Promise<void>;
  feature: (profileId: string, assetId: string | null) => Promise<void>;
  setDeleted: (profileId: string, assetId: string, deleted: boolean) => Promise<void>;
};

const inputClass =
  "mt-1.5 w-full rounded-control border border-border bg-surface px-3 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-focus";

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function AssetEditor({
  asset,
  index,
  count,
  profileId,
  actions,
  operationBusy,
  runOperation,
}: {
  asset: MediaAsset;
  index: number;
  count: number;
  profileId: string;
  actions: EditorActions;
  operationBusy: boolean;
  runOperation: (successMessage: string, action: () => Promise<void>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(asset);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    await runOperation("Saved.", () => actions.saveMetadata(profileId, draft));
  };

  const move = async (direction: -1 | 1) => {
    const nextIndex = index + direction;
    const container = document.querySelector(`[data-gallery="${profileId}"]`);
    const ids = container ? Array.from(container.querySelectorAll<HTMLElement>("[data-asset-id]")).map((item) => item.dataset.assetId!) : [];
    [ids[index], ids[nextIndex]] = [ids[nextIndex]!, ids[index]!];
    await runOperation("Order saved.", () => actions.reorder(profileId, ids));
  };

  return (
    <li data-asset-id={asset.assetId}>
      <Card className="overflow-hidden" padding="none" surface="strong">
        <div className="grid lg:grid-cols-[minmax(14rem,0.8fr)_minmax(0,1.2fr)]">
          <div className="relative min-h-56 bg-canvas-muted">
            {asset.imageUrl ? (
              // Controlled VRDex asset routes are intentionally rendered as ordinary images.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={draft.altText || `${draft.label || "Profile media"} preview`}
                className="absolute inset-0 size-full object-contain"
                src={asset.imageUrl}
              />
            ) : null}
            {asset.featured ? (
              <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-control bg-background/90 px-2.5 py-1.5 text-xs font-medium shadow-panel">
                <Star aria-hidden="true" className="size-3.5 fill-current" />
                Featured
              </span>
            ) : null}
          </div>

          <form className="grid gap-4 p-5" onSubmit={save}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{asset.label || `Image ${index + 1}`}</p>
                <p className="mt-1 text-xs text-muted">
                  {asset.mimeType.replace("image/", "").toUpperCase()} · {formatBytes(asset.byteSize)}
                  {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
                </p>
              </div>
              <div className="flex gap-1">
                <Button aria-label={`Move ${asset.label || `image ${index + 1}`} up`} disabled={operationBusy || index === 0} onClick={() => void move(-1)} size="sm" type="button" variant="ghost">
                  <ArrowUp aria-hidden="true" className="size-4" />
                </Button>
                <Button aria-label={`Move ${asset.label || `image ${index + 1}`} down`} disabled={operationBusy || index === count - 1} onClick={() => void move(1)} size="sm" type="button" variant="ghost">
                  <ArrowDown aria-hidden="true" className="size-4" />
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Title
                <input className={inputClass} maxLength={80} onChange={(event) => setDraft({ ...draft, label: event.target.value })} value={draft.label ?? ""} />
              </label>
              <label className="text-sm font-medium">
                Credit
                <input className={inputClass} maxLength={120} onChange={(event) => setDraft({ ...draft, credit: event.target.value })} value={draft.credit ?? ""} />
              </label>
            </div>
            <label className="text-sm font-medium">
              Accessibility description
              <textarea className={cn(inputClass, "min-h-20 resize-y")} maxLength={180} onChange={(event) => setDraft({ ...draft, altText: event.target.value })} value={draft.altText ?? ""} />
            </label>
            <label className="text-sm font-medium">
              Caption
              <textarea className={cn(inputClass, "min-h-20 resize-y")} maxLength={240} onChange={(event) => setDraft({ ...draft, caption: event.target.value })} value={draft.caption ?? ""} />
            </label>

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button disabled={operationBusy} type="submit" variant="primary">{operationBusy ? "Saving…" : "Save"}</Button>
              <Button disabled={operationBusy || asset.featured} onClick={() => void runOperation("Featured.", () => actions.feature(profileId, asset.assetId))} type="button" variant="secondary">
                <Star aria-hidden="true" className="mr-2 size-4" />
                {asset.featured ? "Featured" : "Make featured"}
              </Button>
              <Button className="ml-auto" disabled={operationBusy} onClick={() => void runOperation("Removed.", () => actions.setDeleted(profileId, asset.assetId, true))} type="button" variant="ghost">
                <Trash2 aria-hidden="true" className="mr-2 size-4" />
                Remove
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </li>
  );
}

function MediaKitEditor({ initialProfiles, actions }: { initialProfiles: MediaProfile[]; actions: EditorActions }) {
  const [selectedId, setSelectedId] = useState(initialProfiles[0]?.profileId ?? "");
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationStatus, setOperationStatus] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadMetadata, setUploadMetadata] = useState({ label: "", altText: "", credit: "" });
  const profile = initialProfiles.find((item) => item.profileId === selectedId) ?? initialProfiles[0];
  const activeAssets = profile?.assets.filter((asset) => asset.state === "active") ?? [];
  const deletedAssets = profile?.assets.filter((asset) => asset.state === "deleted") ?? [];

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !profile) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type)) {
      setUploadStatus("Choose a PNG, JPEG, WebP, or SVG image.");
      return;
    }
    if (file.size <= 0 || file.size > 12 * 1024 * 1024) {
      setUploadStatus("Choose an image up to 12 MB.");
      return;
    }
    setPendingFile(file);
    setUploadMetadata({
      label: file.name.replace(/\.[^.]+$/, "").slice(0, 80),
      altText: "",
      credit: "",
    });
    setUploadStatus("");
  };

  const publishUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!pendingFile || !profile) return;
    if (!uploadMetadata.label.trim() || !uploadMetadata.altText.trim()) {
      setUploadStatus("Title and accessibility description are required.");
      return;
    }
    setUploading(true);
    setUploadStatus(`Uploading ${pendingFile.name}…`);
    try {
      await actions.upload(profile.profileId, pendingFile, uploadMetadata);
      setUploadStatus("Published.");
      setPendingFile(null);
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const runOperation = async (successMessage: string, action: () => Promise<void>) => {
    setOperationBusy(true);
    setOperationStatus("");
    try {
      await action();
      setOperationStatus(successMessage);
    } catch (error) {
      setOperationStatus(error instanceof Error ? error.message : "Change failed. Try again.");
    } finally {
      setOperationBusy(false);
    }
  };

  if (!profile) {
    return (
      <Notice variant="dashed">
        No profiles
      </Notice>
    );
  }

  return (
    <div className="grid gap-8">
      <Card padding="lg">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <label className="text-sm font-medium" htmlFor="media-profile">Profile</label>
            <select className={cn(inputClass, "max-w-md")} id="media-profile" onChange={(event) => setSelectedId(event.target.value)} value={profile.profileId}>
              {initialProfiles.map((item) => <option key={item.profileId} value={item.profileId}>{item.displayName}</option>)}
            </select>
            <p className="mt-3 text-sm text-muted">{activeAssets.length} / 12</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "secondary" })} href={`/${profile.profileType === "community" ? "c" : "p"}/${profile.slug}`}>
              View profile
            </Link>
            <label className={cn(buttonVariants({ variant: "primary" }), "cursor-pointer focus-within:ring-2 focus-within:ring-focus focus-within:ring-offset-2", uploading || activeAssets.length >= 12 ? "pointer-events-none opacity-60" : "")}>
              <ImagePlus aria-hidden="true" className="mr-2 size-4" />
              {uploading ? "Uploading…" : "Add image"}
              <input accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" disabled={uploading || activeAssets.length >= 12} onChange={chooseFile} type="file" />
            </label>
          </div>
        </div>
        {uploading ? <progress aria-label="Image upload in progress" className="mt-5 w-full" /> : null}
        <p aria-live="polite" className="mt-3 min-h-6 text-sm text-muted">{uploadStatus}</p>
        {pendingFile ? (
          <form className="mt-4 grid gap-4 border-t border-border pt-4" onSubmit={publishUpload}>
            <p className="text-sm font-medium">{pendingFile.name}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Title
                <input className={inputClass} maxLength={80} onChange={(event) => setUploadMetadata({ ...uploadMetadata, label: event.target.value })} required value={uploadMetadata.label} />
              </label>
              <label className="text-sm font-medium">
                Credit
                <input className={inputClass} maxLength={120} onChange={(event) => setUploadMetadata({ ...uploadMetadata, credit: event.target.value })} value={uploadMetadata.credit} />
              </label>
            </div>
            <label className="text-sm font-medium">
              Accessibility description
              <textarea className={cn(inputClass, "min-h-20 resize-y")} maxLength={180} onChange={(event) => setUploadMetadata({ ...uploadMetadata, altText: event.target.value })} required value={uploadMetadata.altText} />
            </label>
            <div className="flex gap-2">
              <Button disabled={uploading} type="submit" variant="primary">Publish</Button>
              <Button disabled={uploading} onClick={() => setPendingFile(null)} type="button" variant="ghost">Cancel</Button>
            </div>
          </form>
        ) : null}
      </Card>

      {activeAssets.length > 0 ? (
        <section aria-labelledby="gallery-heading">
          <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-2xl font-semibold" id="gallery-heading">Public gallery</h2>
            </div>
            {activeAssets.some((asset) => asset.featured) ? (
              <Button className="whitespace-nowrap" disabled={operationBusy} onClick={() => void runOperation("Featured cleared.", () => actions.feature(profile.profileId, null))} size="sm" type="button" variant="ghost">
                Clear featured
              </Button>
            ) : null}
          </div>
          <ol className="grid gap-4" data-gallery={profile.profileId}>
            {activeAssets.map((asset, index) => (
              <AssetEditor actions={actions} asset={asset} count={activeAssets.length} index={index} key={asset.assetId} operationBusy={operationBusy} profileId={profile.profileId} runOperation={runOperation} />
            ))}
          </ol>
        </section>
      ) : (
        <Notice variant="dashed">
          No images
        </Notice>
      )}

      {deletedAssets.length > 0 ? (
        <section aria-labelledby="removed-heading" className="border-t border-border pt-7">
          <h2 className="text-lg font-semibold" id="removed-heading">Recently removed</h2>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {deletedAssets.map((asset) => (
              <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={asset.assetId}>
                <span className="text-sm">{asset.label || "Untitled image"}</span>
                <Button disabled={operationBusy} onClick={() => void runOperation("Restored.", () => actions.setDeleted(profile.profileId, asset.assetId, false))} size="sm" type="button" variant="secondary">
                  <RotateCcw aria-hidden="true" className="mr-2 size-4" />
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p aria-live="polite" className="min-h-5 text-sm text-muted">{operationStatus}</p>
    </div>
  );
}

const demoProfiles: MediaProfile[] = [{
  profileId: "demo-profile",
  profileType: "person",
  slug: "playwright-dj-aurora",
  displayName: "DJ Aurora",
  assets: [
    {
      assetId: "aurora-primary",
      state: "active",
      label: "Aurora press portrait",
      caption: "Warm-room portrait for lineups and editorial coverage.",
      altText: "DJ Aurora framed by violet light and a warm orange glow.",
      credit: "Artwork by Afterglow Studio",
      mimeType: "image/webp",
      byteSize: 428_000,
      width: 1600,
      height: 1200,
      featured: true,
      imageUrl: "/api/e2e/fixture-assets/fixture-aurora-profile-image",
    },
    {
      assetId: "aurora-logo",
      state: "active",
      label: "Aurora wordmark",
      caption: "Primary landscape mark on a dark background.",
      altText: "AURORA wordmark in white over violet and cyan light.",
      mimeType: "image/svg+xml",
      byteSize: 86_000,
      width: 1200,
      height: 675,
      featured: false,
      imageUrl: "/api/e2e/fixture-assets/fixture-aurora-primary-logo",
    },
    {
      assetId: "aurora-removed",
      state: "deleted",
      label: "Old square mark",
      mimeType: "image/png",
      byteSize: 210_000,
      featured: false,
    },
  ],
}];

function DemoMediaKitPanel() {
  const [profiles, setProfiles] = useState(demoProfiles);
  const actions = useMemo<EditorActions>(() => ({
    upload: async () => {
      throw new Error("Synthetic preview storage does not accept new files.");
    },
    saveMetadata: async (profileId, updated) => {
      setProfiles((items) => items.map((profile) => profile.profileId === profileId
        ? { ...profile, assets: profile.assets.map((asset) => asset.assetId === updated.assetId ? updated : asset) }
        : profile));
    },
    reorder: async (profileId, assetIds) => {
      setProfiles((items) => items.map((profile) => {
        if (profile.profileId !== profileId) return profile;
        const active = assetIds.map((assetId) => profile.assets.find((asset) => asset.assetId === assetId)!).filter(Boolean);
        return { ...profile, assets: [...active, ...profile.assets.filter((asset) => asset.state === "deleted")] };
      }));
    },
    feature: async (profileId, assetId) => {
      setProfiles((items) => items.map((profile) => profile.profileId === profileId
        ? { ...profile, assets: profile.assets.map((asset) => ({ ...asset, featured: asset.assetId === assetId })) }
        : profile));
    },
    setDeleted: async (profileId, assetId, deleted) => {
      setProfiles((items) => items.map((profile) => profile.profileId === profileId
        ? { ...profile, assets: profile.assets.map((asset) => asset.assetId === assetId ? { ...asset, state: deleted ? "deleted" : "active", featured: deleted ? false : asset.featured } : asset) }
        : profile));
    },
  }), []);
  return <MediaKitEditor actions={actions} initialProfiles={profiles} />;
}

function ConnectedMediaKitPanel() {
  const profiles = useQuery(api.profileAssets.listOwnedMediaKitProfiles);
  const createUploadIntent = useMutation(api.profileAssets.createUploadIntentForOwnedProfile);
  const updateMetadata = useMutation(api.profileAssets.updateOwnedAssetMetadata);
  const reorderGallery = useMutation(api.profileAssets.reorderOwnedGallery);
  const setFeatured = useMutation(api.profileAssets.setOwnedFeaturedAsset);
  const setDeleted = useMutation(api.profileAssets.setOwnedAssetDeleted);

  if (profiles === undefined) return <p className="text-sm text-muted">Loading media kit…</p>;
  if (profiles === null) return <Notice variant="warning">Sign in to manage profile media.</Notice>;

  const actions: EditorActions = {
    upload: async (profileId, file, metadata) => {
      const intent = await createUploadIntent({
        profileId: profileId as Id<"profiles">,
        originalFileName: file.name,
        mimeType: file.type,
        byteSize: file.size,
        label: metadata.label,
        altText: metadata.altText,
        credit: metadata.credit,
        placements: ["gallery"],
      });
      const data = new FormData();
      data.set("file", file);
      const response = await fetch(intent.uploadUrl, {
        method: "POST",
        headers: { [intent.uploadTokenHeader]: intent.uploadToken },
        body: data,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "Upload failed. Try again.");
      }
    },
    saveMetadata: async (profileId, asset) => {
      await updateMetadata({
        profileId: profileId as Id<"profiles">,
        assetId: asset.assetId as Id<"profileAssets">,
        label: asset.label,
        caption: asset.caption,
        altText: asset.altText,
        credit: asset.credit,
      });
    },
    reorder: async (profileId, assetIds) => {
      await reorderGallery({
        profileId: profileId as Id<"profiles">,
        assetIds: assetIds as Id<"profileAssets">[],
      });
    },
    feature: async (profileId, assetId) => {
      await setFeatured({
        profileId: profileId as Id<"profiles">,
        assetId: assetId as Id<"profileAssets"> | null,
      });
    },
    setDeleted: async (profileId, assetId, deleted) => {
      await setDeleted({
        profileId: profileId as Id<"profiles">,
        assetId: assetId as Id<"profileAssets">,
        deleted,
      });
    },
  };

  return <MediaKitEditor actions={actions} initialProfiles={profiles as MediaProfile[]} />;
}

export function MediaKitPanel({ demoMode }: { demoMode: boolean }) {
  return demoMode ? <DemoMediaKitPanel /> : <ConnectedMediaKitPanel />;
}
