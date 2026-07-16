export function safeImageUrl(imageUrl: string | undefined): string | undefined {
  if (!imageUrl) {
    return undefined;
  }

  if (imageUrl.startsWith("/") && !imageUrl.startsWith("//")) {
    return imageUrl;
  }

  try {
    const url = new URL(imageUrl);

    if (url.protocol !== "https:") {
      return undefined;
    }

    return url.href;
  } catch {
    return undefined;
  }
}

export function safeImageBackground(imageUrl: string | undefined, overlay?: string) {
  const safeUrl = safeImageUrl(imageUrl);

  if (!safeUrl) {
    return undefined;
  }

  const image = `url(${JSON.stringify(safeUrl)})`;

  return {
    backgroundImage: overlay ? `${overlay}, ${image}` : image,
  };
}
