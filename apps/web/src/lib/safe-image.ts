export function safeImageBackground(imageUrl: string | undefined, overlay?: string) {
  if (!imageUrl) {
    return undefined;
  }

  if (imageUrl.startsWith("/") && !imageUrl.startsWith("//")) {
    const image = `url(${JSON.stringify(imageUrl)})`;

    return {
      backgroundImage: overlay ? `${overlay}, ${image}` : image,
    };
  }

  try {
    const url = new URL(imageUrl);

    if (url.protocol !== "https:") {
      return undefined;
    }

    const image = `url(${JSON.stringify(url.href)})`;

    return {
      backgroundImage: overlay ? `${overlay}, ${image}` : image,
    };
  } catch {
    return undefined;
  }
}
