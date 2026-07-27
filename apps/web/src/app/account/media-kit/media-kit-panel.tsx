"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowDown, ArrowUp, ImagePlus, RotateCcw, Star, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { MediaPreviewImage } from "@/app/_components/media-preview-image";
import { cn } from "@/lib/cn";
import { profileMediaMimeType } from "@/lib/profile-media-kit";

import {
  prepareProfileMediaUpload,
  type PreparedProfileMediaUpload,
} from "./prepare-profile-media-upload";

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
  gallery: boolean;
  featured: boolean;
  imageUrl?: string;
};

type MediaProfile = {
  profileId: string;
  profileType: "person" | "community";
  slug: string;
  displayName: string;
  activePublicAssetCount: number;
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

type ActionStatus = {
  kind: "error" | "progress" | "success";
  message: string;
};

const inputClass =
  "mt-1.5 w-full rounded-control border border-border bg-surface px-3 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-focus";

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ActionStatusMessage({ className, status }: { className?: string; status: ActionStatus | null }) {
  if (!status) return null;

  if (status?.kind === "error") {
    return (
      <Notice className={className} role="alert" variant="error">
        {status.message}
      </Notice>
    );
  }

  return (
    <p className={cn("text-sm text-muted", className)} role="status">
      {status.message}
    </p>
  );
}

function AssetEditor({
  asset,
  index,
  count,
  profileId,
  actions,
  operationBusy,
  runOperation,
  onRemoved,
}: {
  asset: MediaAsset;
  index: number;
  count: number;
  profileId: string;
  actions: EditorActions;
  operationBusy: boolean;
  runOperation: (
    successMessage: string,
    action: () => Promise<void>,
    setStatus: (status: ActionStatus | null) => void,
  ) => Promise<boolean>;
  onRemoved: (assetId: string) => void;
}) {
  const [draft, setDraft] = useState(asset);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<ActionStatus | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    await runOperation("Saved.", () => actions.saveMetadata(profileId, draft), setStatus);
    setSaving(false);
  };

  const move = async (direction: -1 | 1) => {
    const nextIndex = index + direction;
    const container = document.querySelector(`[data-gallery="${profileId}"]`);
    const ids = container ? Array.from(container.querySelectorAll<HTMLElement>("[data-asset-id]")).map((item) => item.dataset.assetId!) : [];
    [ids[index], ids[nextIndex]] = [ids[nextIndex]!, ids[index]!];
    await runOperation("Order saved.", () => actions.reorder(profileId, ids), setStatus);
  };

  const remove = async () => {
    const removed = await runOperation(
      "Removed.",
      () => actions.setDeleted(profileId, asset.assetId, true),
      setStatus,
    );
    if (removed) onRemoved(asset.assetId);
  };

  return (
    <li data-asset-id={asset.assetId} id={`active-${asset.assetId}`} tabIndex={-1}>
      <Card className="overflow-hidden" padding="none" surface="strong">
        <div className="grid lg:grid-cols-[minmax(14rem,0.8fr)_minmax(0,1.2fr)]">
          <div className="relative min-h-56 bg-canvas-muted">
            {asset.imageUrl ? (
              <MediaPreviewImage
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
              <Button disabled={operationBusy} type="submit" variant="primary">{saving ? "Saving…" : "Save"}</Button>
              <Button
                disabled={operationBusy || asset.featured}
                onClick={() => {
                  void runOperation(
                    "Featured.",
                    () => actions.feature(profileId, asset.assetId),
                    setStatus,
                  );
                }}
                type="button"
                variant="secondary"
              >
                <Star aria-hidden="true" className="mr-2 size-4" />
                {asset.featured ? "Featured" : "Make featured"}
              </Button>
              <Button className="ml-auto" disabled={operationBusy} onClick={() => void remove()} type="button" variant="ghost">
                <Trash2 aria-hidden="true" className="mr-2 size-4" />
                Remove
              </Button>
            </div>
            <ActionStatusMessage status={status} />
          </form>
        </div>
      </Card>
    </li>
  );
}

function OtherAsset({
  asset,
  profileId,
  actions,
  operationBusy,
  runOperation,
  onRemoved,
}: {
  asset: MediaAsset;
  profileId: string;
  actions: EditorActions;
  operationBusy: boolean;
  runOperation: (
    successMessage: string,
    action: () => Promise<void>,
    setStatus: (status: ActionStatus | null) => void,
  ) => Promise<boolean>;
  onRemoved: (assetId: string) => void;
}) {
  const [status, setStatus] = useState<ActionStatus | null>(null);
  const remove = async () => {
    const removed = await runOperation(
      "Removed.",
      () => actions.setDeleted(profileId, asset.assetId, true),
      setStatus,
    );
    if (removed) onRemoved(asset.assetId);
  };

  return (
    <li className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 py-4 sm:grid-cols-[6rem_minmax(0,1fr)_auto]" id={`active-${asset.assetId}`} tabIndex={-1}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-control bg-canvas-muted">
        {asset.imageUrl ? (
          <MediaPreviewImage
            alt={asset.altText || `${asset.label || "Profile media"} preview`}
            className="absolute inset-0 size-full object-contain"
            src={asset.imageUrl}
          />
        ) : null}
      </div>
      <div>
        <p className="font-medium">{asset.label || "Untitled image"}</p>
        <p className="mt-1 text-xs text-muted">
          {asset.mimeType.replace("image/", "").toUpperCase()} · {formatBytes(asset.byteSize)}
        </p>
        <ActionStatusMessage className="mt-2" status={status} />
      </div>
      <Button className="col-span-2 justify-self-end sm:col-span-1" disabled={operationBusy} onClick={() => void remove()} type="button" variant="ghost">
        <Trash2 aria-hidden="true" className="mr-2 size-4" />
        Remove
      </Button>
    </li>
  );
}

function MediaKitEditor({
  initialProfiles,
  initialProfileSlug,
  actions,
  onPreparationSettled,
}: {
  initialProfiles: MediaProfile[];
  initialProfileSlug?: string;
  actions: EditorActions;
  onPreparationSettled?: () => void;
}) {
  const [selectedId, setSelectedId] = useState(
    initialProfiles.find((profile) => profile.slug === initialProfileSlug)?.profileId ??
      initialProfiles[0]?.profileId ??
      "",
  );
  const [uploadStatus, setUploadStatus] = useState<ActionStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [operationBusy, setOperationBusy] = useState(false);
  const [galleryStatus, setGalleryStatus] = useState<ActionStatus | null>(null);
  const [removedStatus, setRemovedStatus] = useState<ActionStatus | null>(null);
  const [focusRestoreAssetId, setFocusRestoreAssetId] = useState<string | null>(null);
  const [focusActiveAssetId, setFocusActiveAssetId] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preparedUpload, setPreparedUpload] = useState<PreparedProfileMediaUpload | null>(null);
  const [preparedPreviewUrl, setPreparedPreviewUrl] = useState<string | null>(null);
  const [uploadMetadata, setUploadMetadata] = useState({ label: "", altText: "", credit: "" });
  const prepareRequestRef = useRef(0);
  const uploadRequestRef = useRef(0);
  const profileSelectRef = useRef<HTMLSelectElement>(null);
  const shouldFocusProfileRef = useRef(false);
  const selectedProfile = initialProfiles.find((item) => item.profileId === selectedId);
  const profile = selectedProfile ?? initialProfiles[0];
  const activeAssets = profile?.assets.filter((asset) => asset.state === "active" && asset.gallery) ?? [];
  const otherActiveAssets = profile?.assets.filter((asset) => asset.state === "active" && !asset.gallery) ?? [];
  const deletedAssets = profile?.assets.filter((asset) => asset.state === "deleted") ?? [];
  const activeAssetIds = [...activeAssets, ...otherActiveAssets].map((asset) => asset.assetId).join(",");
  const deletedAssetIds = deletedAssets.map((asset) => asset.assetId).join(",");

  useEffect(() => {
    if (selectedProfile) return;
    prepareRequestRef.current += 1;
    uploadRequestRef.current += 1;
    setUploading(false);
    setPendingFile(null);
    setPreparedUpload(null);
    setUploadMetadata({ label: "", altText: "", credit: "" });
    setUploadStatus(null);
    setGalleryStatus(null);
    setRemovedStatus(null);
    const fallbackId = initialProfiles[0]?.profileId ?? "";
    shouldFocusProfileRef.current = Boolean(fallbackId && selectedId);
    setSelectedId(fallbackId);
  }, [initialProfiles, selectedId, selectedProfile]);

  useEffect(() => {
    if (!preparedUpload?.changed) {
      setPreparedPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(preparedUpload.file);
    setPreparedPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preparedUpload]);

  useEffect(() => {
    if (!selectedProfile || !shouldFocusProfileRef.current) return;
    shouldFocusProfileRef.current = false;
    profileSelectRef.current?.focus();
  }, [selectedProfile]);

  useEffect(() => {
    if (!focusRestoreAssetId) return;
    const restore = document.getElementById(`restore-${focusRestoreAssetId}`);
    if (restore instanceof HTMLElement) {
      restore.focus();
      setFocusRestoreAssetId(null);
    }
  }, [deletedAssetIds, focusRestoreAssetId]);

  useEffect(() => {
    if (!focusActiveAssetId) return;
    const restored = document.getElementById(`active-${focusActiveAssetId}`);
    if (restored instanceof HTMLElement) {
      restored.focus();
      setFocusActiveAssetId(null);
    }
  }, [activeAssetIds, focusActiveAssetId]);

  const selectProfile = (profileId: string) => {
    prepareRequestRef.current += 1;
    uploadRequestRef.current += 1;
    setSelectedId(profileId);
    setPendingFile(null);
    setPreparedUpload(null);
    setUploadMetadata({ label: "", altText: "", credit: "" });
    setUploadStatus(null);
    setGalleryStatus(null);
    setRemovedStatus(null);
  };

  const restoreAsset = async (assetId: string) => {
    if (!profile) return;
    const restored = await runOperation(
      "Restored.",
      () => actions.setDeleted(profile.profileId, assetId, false),
      setRemovedStatus,
    );
    if (restored) setFocusActiveAssetId(assetId);
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !profile) return;
    if (profileMediaMimeType(file.type, file.name) === null) {
      setUploadStatus({ kind: "error", message: "Choose a PNG, JPEG, WebP, or SVG image." });
      return;
    }
    if (file.size <= 0 || file.size > 12 * 1024 * 1024) {
      setUploadStatus({ kind: "error", message: "Choose an image up to 12 MB." });
      return;
    }
    setUploading(true);
    setPendingFile(null);
    setPreparedUpload(null);
    setUploadStatus({ kind: "progress", message: "Preparing…" });
    const requestId = ++prepareRequestRef.current;
    void prepareProfileMediaUpload(file)
      .then((prepared) => {
        if (prepareRequestRef.current !== requestId) return;
        setPendingFile(file);
        setPreparedUpload(prepared);
        setUploadMetadata({
          label: file.name.replace(/\.[^.]+$/, "").slice(0, 80),
          altText: "",
          credit: "",
        });
        setUploadStatus(null);
      })
      .catch((error: unknown) => {
        if (prepareRequestRef.current !== requestId) return;
        setUploadStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "Image could not be prepared for upload.",
        });
      })
      .finally(() => {
        onPreparationSettled?.();
        if (prepareRequestRef.current === requestId) setUploading(false);
      });
  };

  const publishUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!pendingFile || !preparedUpload || !selectedProfile) return;
    if (!uploadMetadata.label.trim()) {
      setUploadStatus({ kind: "error", message: "Title is required." });
      return;
    }
    setUploading(true);
    setUploadStatus({ kind: "progress", message: `Uploading ${pendingFile.name}…` });
    const requestId = ++uploadRequestRef.current;
    try {
      await actions.upload(selectedProfile.profileId, preparedUpload.file, uploadMetadata);
      if (uploadRequestRef.current !== requestId) return;
      setUploadStatus({ kind: "success", message: "Published." });
      setPendingFile(null);
      setPreparedUpload(null);
    } catch (error) {
      if (uploadRequestRef.current !== requestId) return;
      setUploadStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Upload failed. Try again.",
      });
    } finally {
      if (uploadRequestRef.current === requestId) setUploading(false);
    }
  };

  const runOperation = async (
    successMessage: string,
    action: () => Promise<void>,
    setStatus: (status: ActionStatus | null) => void,
  ) => {
    setOperationBusy(true);
    setStatus(null);
    try {
      await action();
      setStatus({ kind: "success", message: successMessage });
      return true;
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Change failed. Try again.",
      });
      return false;
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
            <select className={cn(inputClass, "max-w-md")} disabled={uploading || operationBusy} id="media-profile" onChange={(event) => selectProfile(event.target.value)} ref={profileSelectRef} value={profile.profileId}>
              {initialProfiles.map((item) => <option key={item.profileId} value={item.profileId}>{item.displayName}</option>)}
            </select>
            <p className="mt-3 text-sm text-muted">{profile.activePublicAssetCount} / 12</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants({ variant: "secondary" })} href={`/${profile.profileType === "community" ? "c" : "p"}/${profile.slug}`}>
              View profile
            </Link>
            <label className={cn(buttonVariants({ variant: "primary" }), "cursor-pointer focus-within:ring-2 focus-within:ring-focus focus-within:ring-offset-2", !selectedProfile || uploading || profile.activePublicAssetCount >= 12 ? "pointer-events-none opacity-60" : "")}>
              <ImagePlus aria-hidden="true" className="mr-2 size-4" />
              {uploading ? (pendingFile ? "Uploading…" : "Preparing…") : "Add image"}
              <input accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" disabled={!selectedProfile || uploading || profile.activePublicAssetCount >= 12} onChange={chooseFile} type="file" />
            </label>
          </div>
        </div>
        {uploading ? <progress aria-label={pendingFile ? "Image upload in progress" : "Image preparation in progress"} className="mt-5 w-full" /> : null}
        {!pendingFile ? <ActionStatusMessage className="mt-3" status={uploadStatus} /> : null}
        {selectedProfile && pendingFile ? (
          <form className="mt-4 grid gap-4 border-t border-border pt-4" onSubmit={publishUpload}>
            <p className="text-sm font-medium">{pendingFile.name}</p>
            {preparedUpload?.changed && preparedPreviewUrl ? (
              <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
                <Image alt="" className="aspect-square w-32 rounded-control border border-border bg-canvas-muted object-contain" height={128} src={preparedPreviewUrl} unoptimized width={128} />
                <p className="text-sm text-muted">
                  {profileMediaMimeType(pendingFile.type, pendingFile.name)?.replace("image/", "").toUpperCase()} · {formatBytes(pendingFile.size)}
                  {" → "}
                  WEBP · {formatBytes(preparedUpload.file.size)}
                  {preparedUpload.width && preparedUpload.height ? ` · ${preparedUpload.width} × ${preparedUpload.height}` : ""}
                </p>
              </div>
            ) : null}
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
              <textarea className={cn(inputClass, "min-h-20 resize-y")} maxLength={180} onChange={(event) => setUploadMetadata({ ...uploadMetadata, altText: event.target.value })} value={uploadMetadata.altText} />
            </label>
            <div className="flex gap-2">
              <Button disabled={uploading} type="submit" variant="primary">Publish</Button>
              <Button disabled={uploading} onClick={() => {
                setPendingFile(null);
                setPreparedUpload(null);
              }} type="button" variant="ghost">Cancel</Button>
            </div>
            <ActionStatusMessage status={uploadStatus} />
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
              <Button className="whitespace-nowrap" disabled={operationBusy} onClick={() => void runOperation("Featured cleared.", () => actions.feature(profile.profileId, null), setGalleryStatus)} size="sm" type="button" variant="ghost">
                Clear featured
              </Button>
            ) : null}
          </div>
          <ActionStatusMessage className="mb-4" status={galleryStatus} />
          <ol className="grid gap-4" data-gallery={profile.profileId}>
            {activeAssets.map((asset, index) => (
              <AssetEditor
                actions={actions}
                asset={asset}
                count={activeAssets.length}
                index={index}
                key={asset.assetId}
                onRemoved={setFocusRestoreAssetId}
                operationBusy={operationBusy}
                profileId={profile.profileId}
                runOperation={runOperation}
              />
            ))}
          </ol>
        </section>
      ) : (
        <Notice variant="dashed">
          No images
        </Notice>
      )}

      {otherActiveAssets.length > 0 ? (
        <section aria-labelledby="other-media-heading" className="border-t border-border pt-7">
          <h2 className="text-lg font-semibold" id="other-media-heading">Other profile media</h2>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {otherActiveAssets.map((asset) => (
              <OtherAsset
                actions={actions}
                asset={asset}
                key={asset.assetId}
                onRemoved={setFocusRestoreAssetId}
                operationBusy={operationBusy}
                profileId={profile.profileId}
                runOperation={runOperation}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {deletedAssets.length > 0 ? (
        <section aria-labelledby="removed-heading" className="border-t border-border pt-7">
          <h2 className="text-lg font-semibold" id="removed-heading">Recently removed</h2>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {deletedAssets.map((asset) => (
              <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={asset.assetId}>
                <span className="text-sm">{asset.label || "Untitled image"}</span>
                <Button
                  disabled={operationBusy}
                  id={`restore-${asset.assetId}`}
                  onClick={() => void restoreAsset(asset.assetId)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <RotateCcw aria-hidden="true" className="mr-2 size-4" />
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ActionStatusMessage status={removedStatus} />
    </div>
  );
}

const demoProfiles: MediaProfile[] = [
  {
    profileId: "demo-profile",
    profileType: "person",
    slug: "playwright-dj-aurora",
    displayName: "DJ Aurora",
    activePublicAssetCount: 3,
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
      gallery: true,
      featured: true,
      imageUrl: "/api/e2e/fixture-assets/fixture-aurora-profile-image",
    },
    {
      assetId: "aurora-logo",
      state: "active",
      label: "Aurora wordmark",
      caption: "Primary landscape mark on a dark background.",
      mimeType: "image/svg+xml",
      byteSize: 86_000,
      width: 1200,
      height: 675,
      gallery: true,
      featured: false,
      imageUrl: "/api/e2e/fixture-assets/fixture-aurora-primary-logo",
    },
    {
      assetId: "aurora-avatar",
      state: "active",
      label: "Old square mark",
      altText: "AURORA wordmark in white over violet and cyan light.",
      mimeType: "image/png",
      byteSize: 210_000,
      width: 800,
      height: 800,
      gallery: false,
      featured: false,
      imageUrl: "/api/e2e/fixture-assets/fixture-aurora-alt-logo",
    },
    {
      assetId: "aurora-removed",
      state: "deleted",
      label: "Old square mark",
      mimeType: "image/png",
      byteSize: 210_000,
      gallery: true,
      featured: false,
    },
    ],
  },
  {
    profileId: "demo-community",
    profileType: "community",
    slug: "playwright-night-shift",
    displayName: "Night Shift",
    activePublicAssetCount: 0,
    assets: [],
  },
];

function DemoMediaKitPanel({ initialProfileSlug }: { initialProfileSlug?: string }) {
  const [profiles, setProfiles] = useState(demoProfiles);
  useEffect(() => {
    const toggleProfile = (event: Event) => {
      const { profileId, present } = (event as CustomEvent<{ profileId: string; present: boolean }>).detail;
      setProfiles((items) => {
        if (!present) return items.filter((profile) => profile.profileId !== profileId);
        if (items.some((profile) => profile.profileId === profileId)) return items;
        const fixture = demoProfiles.find((profile) => profile.profileId === profileId);
        return fixture ? [...items, fixture] : items;
      });
    };
    window.addEventListener("vrdex:toggle-media-profile", toggleProfile);
    return () => window.removeEventListener("vrdex:toggle-media-profile", toggleProfile);
  }, []);
  const actions = useMemo<EditorActions>(() => ({
    upload: async (_profileId, file) => {
      const bitmap = file.name.endsWith(".webp") ? await createImageBitmap(file) : null;
      window.dispatchEvent(new CustomEvent("vrdex:media-upload-attempt", {
        detail: {
          name: file.name,
          type: file.type,
          size: file.size,
          ...(bitmap ? { width: bitmap.width, height: bitmap.height } : {}),
        },
      }));
      bitmap?.close();
      if (file.name === "slow.png") {
        await new Promise((resolve) => setTimeout(resolve, 500));
        window.dispatchEvent(new Event("vrdex:media-upload-settled"));
      }
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
  return (
    <MediaKitEditor
      actions={actions}
      initialProfiles={profiles}
      initialProfileSlug={initialProfileSlug}
      onPreparationSettled={() => window.dispatchEvent(new Event("vrdex:media-preparation-settled"))}
    />
  );
}

function ConnectedMediaKitPanel({ initialProfileSlug }: { initialProfileSlug?: string }) {
  const profiles = useQuery(api.profileAssets.listOwnedMediaKitProfiles);
  const createUploadIntent = useMutation(api.profileAssets.createUploadIntentForOwnedProfile);
  const cancelUploadIntent = useMutation(api.profileAssets.cancelOwnedUploadIntent);
  const updateMetadata = useMutation(api.profileAssets.updateOwnedAssetMetadata);
  const reorderGallery = useMutation(api.profileAssets.reorderOwnedGallery);
  const setFeatured = useMutation(api.profileAssets.setOwnedFeaturedAsset);
  const setDeleted = useMutation(api.profileAssets.setOwnedAssetDeleted);

  if (profiles === undefined) return <p aria-busy="true" className="text-sm text-muted" role="status">Loading media kit…</p>;
  if (profiles === null) return <Notice variant="warning">Sign in to manage profile media.</Notice>;

  const actions: EditorActions = {
    upload: async (profileId, file, metadata) => {
      const intent = await createUploadIntent({
        profileId: profileId as Id<"profiles">,
        originalFileName: file.name,
        mimeType:
          profileMediaMimeType(file.type, file.name) ??
          file.type,
        byteSize: file.size,
        label: metadata.label,
        altText: metadata.altText,
        credit: metadata.credit,
        placements: ["gallery"],
      });
      try {
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
      } catch (error) {
        await cancelUploadIntent({
          intentId: intent.intentId,
          uploadToken: intent.uploadToken,
        }).catch(() => false);
        throw error;
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

  return (
    <MediaKitEditor
      actions={actions}
      initialProfiles={profiles as MediaProfile[]}
      initialProfileSlug={initialProfileSlug}
    />
  );
}

export function MediaKitPanel({
  demoMode,
  initialProfileSlug,
}: {
  demoMode: boolean;
  initialProfileSlug?: string;
}) {
  return demoMode ? (
    <DemoMediaKitPanel initialProfileSlug={initialProfileSlug} />
  ) : (
    <ConnectedMediaKitPanel initialProfileSlug={initialProfileSlug} />
  );
}
