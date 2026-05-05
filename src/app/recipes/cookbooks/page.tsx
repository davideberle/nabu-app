import Link from "next/link";
import Image from "next/image";
import { getCookbooks } from "@/lib/recipes";
import { NabuPageShell, NabuHeader, NabuMain } from "@/components/ui/nabu";

export const revalidate = 60;

export default async function CookbooksPage() {
  const cookbooks = await getCookbooks();
  const totalRecipes = cookbooks.reduce((sum, c) => sum + c.count, 0);

  return (
    <NabuPageShell>
      <NabuHeader
        title="Cookbooks"
        subtitle={`${cookbooks.length} books · ${totalRecipes} recipes`}
        backHref="/recipes"
        maxWidth="5xl"
      />

      <NabuMain maxWidth="5xl">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {cookbooks.map((cookbook) => (
            <Link
              key={cookbook.slug}
              href={`/recipes/cookbook/${cookbook.slug}`}
              className="group"
            >
              <div className="relative aspect-[3/4] rounded-xl overflow-hidden border border-primary bg-secondary shadow-sm group-hover:shadow-lg transition-shadow">
                {cookbook.cover ? (
                  <Image
                    src={cookbook.cover}
                    alt={cookbook.name}
                    fill
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center p-4">
                    <span className="text-center font-serif text-quaternary text-sm leading-tight">
                      {cookbook.name}
                    </span>
                  </div>
                )}
                {/* Gradient overlay on hover */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              <div className="mt-3">
                <h2 className="font-serif text-primary text-sm leading-tight line-clamp-2 group-hover:text-secondary transition-colors">
                  {cookbook.name}
                </h2>
                {cookbook.author && (
                  <p className="text-xs text-tertiary mt-1 line-clamp-1">
                    {cookbook.author}
                  </p>
                )}
                <p className="text-xs text-quaternary mt-1">
                  {cookbook.count} recipes
                </p>
              </div>
            </Link>
          ))}
        </div>
      </NabuMain>
    </NabuPageShell>
  );
}
