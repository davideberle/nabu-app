#!/usr/bin/env python3
"""Phase 2 Recipe Catalog Cleanup: Fix junk OCR names and remove duplicates."""

import json
import os
import sys
from pathlib import Path

RECIPES_DIR = Path(__file__).parent.parent / "src" / "data" / "recipes"

# ============================================================
# DUPLICATES TO DELETE
# These are confirmed duplicates (verified by comparing ingredients)
# ============================================================

DUPLICATES_TO_DELETE = [
    # --- Ottolenghi Simple: intro-text duplicates of legitimate recipes ---
    "all-sorts-of-different-avored-chocolate-ginger-chocolate-chile-chocolate-and-so.json",  # = mint-and-pistachio-chocolate-fridge-cake
    "buy-a-big-batch-of-cherry-tomatoes-when-they-are-ripe-and-sweet-and-double-or.json",  # = fettuccine-with-spiced-cherry-tomato-sauce
    "for-all-the-pans-and-molds-that-can-be-used-to-great-effect-in-baking-there-s.json",  # = blueberry-almond-and-lemon-cake
    "gigli-means-lilies-in-italian-and-their-oral-wavy-edges-are-a-great-vehicle-for.json",  # = gigli-with-chickpeas-and-za-atar
    "i-cook-this-on-the-barbecue-during-the-summer-but-instructions-here-are-for-a.json",  # = grilled-lamb-fillet-with-almonds-and-orange
    "i-like-to-eat-this-either-as-it-is-for-a-quick-lunch-or-light-supper-or-with-som.json",  # = soba-noodles-with-lime-cardamom-and
    "i-like-to-eat-this-either-for-brunch-or-for-a-speedy-supper-with-a-fresh-tomato-.json",  # = harissa-and-manchego-omeletes
    "i-like-to-use-blanched-hazelnuts-to-keep-the-cake-light-in-color-but-unskinned.json",  # = hazelnut-peach-and-raspberry-cake
    "i-tend-to-make-double-the-tomato-sauce-and-keep-the-excess-in-the-fridge-for.json",  # = chile-fish-with-tahini
    "if-lamb-siniyah-see-this-page-is-a-middle-eastern-take-on-the-shepherd-s-pie.json",  # = spiced-shepherd-s-pie-with-lima-bean-crust
    "if-you-get-hooked-on-this-simple-supper-dish-and-i-believe-the-chances-are.json",  # = seeded-chicken-schnitzel
    "if-you-re-doubling-or-tripling-this-recipe-break-the-cauli-ower-into-orets-and-p.json",  # = cauliflower-tabbouleh
    "it-s-a-variation-of-ricotta-that-has-been-pressed-salted-and-dried-its-avor-is.json",  # = pasta-alla-norma
    "keep-all-the-leaves-on-the-head-of-cauli-ower-they-are-deliciously-crisp-and.json",  # = roasted-whole-cauliflower
    "no-oven-no-bain-marie-no-cracks-this-is-the-simplest-of-cheesecakes-you-can.json",  # = honey-and-yogurt-set-cheesecake
    "these-are-delicious-as-they-are-eaten-with-some-bread-alongside-to-mop-up-the.json",  # = grilled-beefsteak-tomatoes-with-chile-garlic
    "this-brings-together-two-of-the-most-simple-and-comforting-dishes-a-baked.json",  # = baked-potatoes-with-egg-and-tonnato-sauce
    "this-can-either-be-eaten-as-it-is-slightly-warm-or-at-room-temperature-served.json",  # = spiced-apple-cake
    "this-is-a-good-dessert-if-you-have-overripe-strawberries-that-are-slightly-past-.json",  # = sumac-roasted-strawberries-with-yogurt
    "this-is-a-great-dish-to-feed-friends-if-you-like-knowing-that-all-the-work-that-.json",  # = harissa-beef-sirloin-with-pepper-and-lemon
    "this-is-a-quick-way-to-get-a-very-comforting-meal-on-the-table-in-a-wonderfully.json",  # = braised-eggs-with-leek-and-za-atar
    "this-is-a-regular-feature-at-home-on-the-weekend-when-karl-and-i-are-feeding.json",  # = zucchini-and-ciabatta-frittata
    "this-is-one-of-those-dishes-that-is-simple-and-quick-enough-for-midweek-but.json",  # = roasted-trout-with-tomato-orange-and
    "this-is-the-centerpiece-for-an-asian-style-feast-served-with-some-thai-sticky-ri.json",  # = whole-roasted-sea-bass-with-soy-sauce-and
    "this-is-the-ultimate-comfort-dish-looking-for-a-roast-chicken-some-sausages-or-a.json",  # = mustardy-cauliflower-cheese
    "this-makes-a-welcome-change-to-the-sh-nger-theme-for-kids-who-love-this.json",  # = coconut-crusted-fish-fingers
    "this-might-seem-like-a-lot-to-serve-four-but-it-s-so-light-and-uffy-that-you-ll-.json",  # = fig-and-thyme-clafoutis
    "this-salad-is-perfect-at-a-summer-barbecue-great-alongside-all-sorts-of-grilled.json",  # = couscous-cherry-tomato-and-herb-salad
    "to-get-ahead-the-salsa-can-be-made-a-few-hours-in-advance-and-kept-in-the.json",  # = baked-mint-rice-with-pomegranate-and-olive
    "two-assumptions-qualify-these-for-ottolenghi-simple-one-is-that-everyone-has.json",  # = nutella-sesame-and-hazelnut-rolls
    "zucchini-become-watery-soon-after-the-salt-has-been-added-so-if-preparing-these.json",  # = zucchini-thyme-and-walnut-salad
    "as-with-all-dishes-that-involve-eggs-and-toast-and-getting-ready-in-the-morning.json",  # = portobello-mushrooms-with-brioche-and
    "pictured-on-this-page-right.json",  # = runner beans in tomato sauce (dup of serve-this-with...)
    "pictured-on-this-page-top.json",  # = pea zucchini basil soup (dup of the-key-to-keeping...)
    "pictured-with-gigli-with-chickpeas-and-za-atar-this-page.json",  # = pappardelle (dup of pappare-means...)

    # --- Thai Curry Cookbook 2: junk-junk duplicates ---
    "flavor-up-your-chicken-wings-with-curry-and-mango-chutney-for-an.json",  # = days.json
    "dance-this-tasty-salad-will-soon-become-a-staple-at-your-kitchen-table-too.json",  # = crunch-from-the-almonds...
    "enjoy-with-friends-give-this-one-a-try-and-enjoy.json",  # = different-tastes-and-flavors...
    "this-easy-to-make-shrimp-recipe-will-be-better-than-what-you-find-in.json",  # = restaurants-flavor-it...
    "evenings-enjoy-the-freshening-moments-from-this-sweet-quinoa.json",  # = curried-quinoa-is...
    "powder-in-this-healthy-side-dish.json",  # = crisp-tender-when-roasted...
    "served-with-a-variety-of-additions-like-refried-beans-or-even-a-serving-of-stir.json",  # = fried-vegetables.json

    # --- Real Thai Cooking: duplicates of legitimate recipes ---
    "with-a-juicy-fried-egg-on-top-it-s-considered-the-quintessential-thai-square-mea.json",  # = pad-krapao-basil-stir-fry
    "people-who-are-new-to-thai-food-and-even-people-who-aren-t-including-some-thai-p.json",  # = nam-prik-gapi-shrimp-paste-dip
    "this-is-the-condiment-that-comes-with-every-bowl-of-steamed-rice-set-on.json",  # = nam-pla-prik-fish-sauce-with-chilies
    "this-dish-adapted-from-the-indians-is-commonly-known-as-khao-mok-gai-or-chicken-.json",  # = thai-style-chicken-biryani
    "whenever-i-see-thai-iced-coffee-i-think-of-her.json",  # = thai-iced-tea

    # --- Jamie's Food Revolution: duplicates of legitimate recipes ---
    "dri7jje-now-and-then-so-the-chicken-and-bell-peppers-stay-nice-and-shiny.json",  # = chicken-fajitas-19-minutes
    "feel-fr-ee-to-t-ry-this-out-using-other-fish-like-trout-haddock-or-sustainable-c.json",  # = salmon-en-croote

    # --- Thai Curry Cookbook 2: duplicates of legitimate recipes ---
    "coated-scallops.json",  # = curry-scallops-and-cilantro-rice
    "and-enjoyable-than-the-usual-ribs-enjoy.json",  # = curried-pork-ribs
    "crisp-tender-when-roasted-and-soaks-up-all-the-delicious-flavor-of-curry.json",  # = curry-roasted-cauliflower
    "curried-quinoa-is-a-perfect-option-during-festivities-significantly-colder.json",  # = curried-quinoa
    "have-more-to-enjoy-up-to-the-weekends-enjoy.json",  # = cod-curry
    "into-the-recipe-well-and-improve-the-taste.json",  # = curry-chicken-with-potatoes
    "used-as-a-meat-option-in-most-vegan-meals.json",  # = coconut-curry-tofu
    "you-won-t-be-able-to-resist-it.json",  # = coconut-curry-chicken
    "this-is-a-medium-spiced-curry-sauce-serve-over-rice.json",  # = curry-coconut-shrimp

    # --- Vegan Nigerian Kitchen: duplicates of legitimate recipes ---
    "akara-page-135-moin-moin-page-156-or-even-pu-pu-page-184.json",  # = ogi-akamu-pap
    "hausa-and-is-made-using-dry-baobab-leaf-powder-also-known-as.json",  # = miyan-kuka-baobab-leaf-soup
    "let-s-head-north-again-with-this-delicious-groundnut-and-zog.json",  # = miyan-zogale-moringa-soup
    "flu-y-yam-cooked-in-a-seasoned-stew-blend-what-could-be-more.json",  # = asaro-yam-porridge
    "pepper.json",  # = yam-pepper-soup-ji-nmiri-oku (confirmed by Vegan Nigerian Kitchen source)
    "light.json",  # = agidi-eko
    "this-dish-gets-its-name-from-the-type-of-leafy-green-vegetab.json",  # = bitter-leaf-soup-ofe-onugbu
    "scrambled.json",  # = scrambled-egg-and-bread-with-sweet-tea
]

# ============================================================
# NAME FIXES
# Map filename -> corrected recipe name
# ============================================================

NAME_FIXES = {
    # --- Ottolenghi Simple: unique recipes needing name fix ---
    "cilantro-stems-can-all-too-often-be-thrown-away-but-they-shouldn-t-be-they.json": "Cilantro Stem and Red Lentil Soup",
    "leftovers-can-also-be-eaten-the-next-day-either-at-room-temperature-or-warmed.json": "Lamb and Feta Meatballs",
    "make-this-throughout-the-year-fresh-raspberries-are-great-when-they-re-in.json": "Raspberry Semifreddo",
    "pappare-means-to-gobble-up-in-italian-which-is-the-destiny-of-this-dish.json": "Pappardelle with Rose Harissa, Olives, and Capers",
    "serve-this-with-some-brown-rice-for-a-dish-that-manages-to-be-both-summery-and.json": "Runner Beans in Tomato Sauce",
    "the-key-to-keeping-a-green-soup-as-green-and-vibrant-as-can-be-is-not-to.json": "Pea, Zucchini, and Basil Soup",
    "this-dish-is-lovely-either-warm-from-the-oven-served-with-sticky-or-basmati-rice.json": "Chicken with Miso, Ginger, and Lime",

    # --- Ottolenghi Simple: truncated names to complete ---
    "arnold-s-roast-chicken-with-caraway-and.json": "Arnold's Roast Chicken with Caraway and Cranberry Stuffing",
    "grilled-beefsteak-tomatoes-with-chile-garlic.json": "Grilled Beefsteak Tomatoes with Chile, Garlic, and Ginger",
    "orzo-with-shrimp-tomato-and-marinated.json": "Orzo with Shrimp, Tomato, and Marinated Feta",
    "soba-noodles-with-lime-cardamom-and.json": "Soba Noodles with Lime, Cardamom, and Avocado",
    "portobello-mushrooms-with-brioche-and.json": "Portobello Mushrooms with Brioche and Poached Eggs",
    "seaweed-spaghetti-and-sesame-salad-with.json": "Seaweed Spaghetti and Sesame Salad with Tahini Dressing",
    "whole-roasted-sea-bass-with-soy-sauce-and.json": "Whole Roasted Sea Bass with Soy Sauce and Ginger",
    "roasted-trout-with-tomato-orange-and.json": "Roasted Trout with Tomato, Orange, and Barberries",
    "aviv.json": "Aviv's Nutella Babka Rolls",
    "pictured-on-this-page-bottom.json": "Coconut Red Lentil Soup",
    "pictured-on-this-page-left.json": "Chickpeas and Swiss Chard with Carrots",
    "pictured-with-5-spice-peach-and-raspberry-salad-this-page.json": "Cucumber and Lamb's Lettuce Salad with Yogurt and Nigella Seeds",

    # --- Thai Curry Cookbook 2: junk names -> recovered names ---
    "appetizing.json": "Curry Chicken Rice Pilaf",
    "days.json": "Curry Chicken Wings with Mango Chutney",
    "make.json": "Duck Green Curry",
    "results.json": "Curry Salmon with Mango Salsa",
    "tastes-great.json": "Slow Cooker Pineapple Red Curry Chicken",
    "and-cheese.json": "Curry and Cheese Cauliflower",
    "fried-vegetables.json": "Curried Acorn Squash",
    "over-rice.json": "Curry Seafood Over Rice",
    "appetizer-that-won-t-last-for-more-than-a-few-minutes-on-the-table.json": "Curry Chicken Wings with Yogurt Dipping Sauce",
    "crunch-from-the-almonds-brings-it-all-together-to-make-your-taste-buds.json": "Curry Chicken Salad Lettuce Wraps",
    "different-tastes-and-flavors-in-popcorn-are-all-you-should-yearn-for-and.json": "Thai Curry Popcorn",
    "few-minutes-of-active-preparation.json": "Red Curry Vegetables with Chickpeas",
    "going-to-love-this-wonderful-recipe.json": "Yellow Curry Duck with Rice Noodles",
    "immediately-serve-this-curried-salmon-with-mango-recipe-for-the-best.json": "Curried Salmon with Mango Salsa",
    "it-with-everyone-around.json": "Curried Beef Meatballs with Yellow Curry Sauce",
    "jackfruit-is-found-everywhere.json": "Thai Stir-Fried Jackfruit",
    "just-when-you-thought-we-had-enough-of-asian-flavors-to-pair-up-with.json": "Red Curry Chicken Wings with Squash and Chickpeas",
    "meld-of-flavors.json": "Curried Tofu with Vegetables",
    "this-dish-is-very-flexible.json": "Coconut Curry Vegetable Stir-Fry",
    "of-some-spices-some-of-which-change-depending-on-the-type-of-curry-you.json": "Curried Beef Meatballs in Tomato Sauce",
    "parties-and-a-great-appetizer-serve-with-celery-and-enjoy.json": "Curried Cream Cheese Celery Bites",
    "protein-you-need-these-meatballs-also-have-the-flavor-you-crave.json": "Curried Chicken Meatballs",
    "recipe-is-quick-and-easy-to-make-throughout-all-seasons.json": "Red Curry Duck with Peanut Satay Sauce",
    "restaurants-flavor-it-with-coconut-milk-and-thai-red-curry-paste.json": "Thai Red Curry Shrimp",
    "rice-enjoy-with-friends-and-family.json": "Thai Curry Chicken",
    "rice-if-in-a-rush.json": "Chickpea Coconut Curry",
    "tawa-chapatti-with-some-roughly-chopped-onion.json": "Curried Egg Masala",
    "this-is-a-northern-thai-dish-that-was-influenced-by-burmese-cuisine.json": "Khao Soi (Northern Thai Curried Noodle Soup with Beef)",
    "this-soup-enjoy.json": "Curried Peanut Soup",
    "try-them-all-but-this-basic-curry-is-a-great-place-to-start.json": "Basic Vegetable Red Curry with Cauliflower Rice",
    "turmeric-quite-often-like-indian-in-their-curries.json": "Thai Mushroom and Vegetable Curry",
    "turns-dinnertime-into-something-special-without-wearing-you-out.json": "Coconut Curry Shrimp",
    "use-the-cauliflower-in-a-nicer-way-by-making-this-soup.json": "Curried Cauliflower Soup",
    "used-as-a-sauce-for-beans-or-tofu.json": "Spicy Coconut Curry Lentil and Barley Stew",
    "well-worth-the-effort.json": "Curried Pork Dumplings with Dipping Sauce",
    "with-other-thai-foods-such-as-curries.json": "Thai Curry Pineapple Fried Rice with Chicken",
    "your-bowl-of-steaming-hot-rice-you-will-eat-lots-of-that-with-this.json": "Red Curry Chicken Wings with Squash",

    # --- Jamie's Food Revolution: junk names -> recovered names ---
    "and-black-bean-sauce.json": "Sizzling Beef with Scallions and Black Bean Sauce",
    "and-pea-sauce.json": "Mini Shell Pasta with Bacon and Pea Sauce",
    "veg-etab-le-b-haj-is.json": "Vegetable Bhajis",
    "spicy-moroccan-ste-led-fish.json": "Spicy Moroccan Stewed Fish",
    "s-a-u-c-e-12-minutes.json": "Shrimp with Avocado and Marie Rose Sauce",
    "s-t-r-0-g-a-no-f-f-19-minutes.json": "Chicken and Leek Stroganoff",
    "this.json": "Cherry Tomato Sauce with Cheat's Fresh Pasta",
    "soup.json": "Vegetable Soup",
    "vvith-crispy-posh-ham.json": "Chicken Wrapped with Crispy Posh Ham",
    "stir-fry.json": "Sweet Chile Shrimp Stir-Fry",
    "asparagus.json": "Grilled Tuna with Asparagus",
    "swiss-chard.json": "Red Lentil and Swiss Chard Soup",
    "it-gives-you-a-slightly-d-rier-dish-w-ith-loads-of-flavor-and-a-go-rgeous-crispy.json": "Crispy Roasted Chicken",
    "parma-ham-or-even-smoked-streaky-bacon-will-work-just-as-well.json": "Chicken Wrapped in Parma Ham",
    "the-garbanzo-beans-add-lovely-texture-to-the-sauce.json": "Pasta with Garbanzo Beans",
    "very-zingy-ve-r-y-brilliant.json": "Zingy Salad Dressing",
    "fo-r-each-stew-you-will-need.json": "Basic Stew",
    # Fix OCR-mangled but partially-correct names
    "chicken-fajitas-19-minutes.json": "Chicken Fajitas",
    "cucumber-yogurt-17-minutes.json": "Cucumber Yogurt",
    "good-old-chill-con-carne.json": "Good Old Chilli Con Carne",
    "smoked-mackerel-pate.json": "Smoked Mackerel Pate",
    "asian-style-s-teamed-salmon.json": "Asian-Style Steamed Salmon",
    "get-into-oatmeal.json": "Get Into Oatmeal",

    # --- Real Thai Cooking: junk names -> recovered names ---
    "grang-om-is-something-the-workers-put-to-the-pot-after-work-when-they-are-hungry.json": "Gang Om (Isaan Workers' Stew)",
    "i-actually-look-forward-to-doctor-visits-because-i-know-that-i-can-go-grab-a-bit.json": "Thai Suki (Glass Noodle Hot Pot)",
    "it-was-diffi-cult-for-me-to-focus-on-one-recipe-for-jaew-to-feature-in-this.json": "Jaew (Isaan Dipping Sauce)",
    "nam-prik-kee-ga-dip-is-also-called-crow-poo-dip-because-it.json": "Nam Prik Kee Ga (Crow Poo Dip)",
    "one-of-the-dishes-that-most-betrays-phuket-s-hokkien-chinese.json": "Moo Hong (Phuket-Style Braised Pork Belly)",
    "the-fi-lling-for-this-recipe-is-isaan-style-chicken-larb-which-i-was-surprised-t.json": "Chicken Larb Spring Rolls",
    "these-cupcakes-are-named-after-the-cotton-balls-that-they-look-like-when-they-ar.json": "Thai Coconut Ice Cream",
    "this-is-a-great-dish-for-a-party-or-large-family-gathering.json": "Gai Yang (Isaan Grilled Chicken)",
    "this-is-known-by-some-people-as-thai-bolognese-because-of-its-resemblance-to.json": "Nam Prik Num (Northern Thai Green Chili Dip)",
    "this-is-one-instance-where-not-using-the-mortar-and-pestle-for-the-fruit-will-pr.json": "Moo Tod (Thai Fried Pork)",
    "this-is-probably-not-a-realistic-thing-to-truly-replicate-when-living-abroad-sin.json": "Gaeng Om (Northern Thai Herbal Soup)",
    "this-is-quite-literally-fried-pork-and-yes-it-s-basically-schnitzel-without-the-.json": "Kanom Jeen Nam Ngiao (Northern Thai Noodles with Spicy Pork-Tomato Sauce)",
    "this-is-usually-eaten-with-pork-rinds-sticky-rice-hard-boiled-eggs-and-boiled-ve.json": "Gaeng Hang Lay (Northern Thai Pork Curry)",
    "this-recipe-is-wetter-than-a-typical-hoy-tod-or-shellfi-sh-omelet-which-is-crisp.json": "Or Suan (Thai Oyster Omelet)",
    "this-recipe-was-inspired-by-the-vietnamese-vets-who-came-over-into-thailand-on-t.json": "Vietnamese-Inspired Thai Spring Rolls",
    "this-was-one-of-the-fi-rst-thai-recipes-i-learnt-so-desperate-was-i-to-have-this.json": "Larb Moo Muang (Northern-Style Pork Larb)",
    "top-with-raw-bean-sprouts-sliv.json": "Khao Soi (Northern Thai Coconut Curry Noodles)",
    "turn-off-the-heat-and-serve-in-a.json": "Khao Niew Mamuang (Mango Sticky Rice)",
    "a-lot-of-recipes-call-for-marinating-the-wings-but-the-best-ones-i-know-are-by-m.json": "Nam Prik Ong (Northern Thai Pork and Tomato Chili Dip)",
    "a-variation-of-this-spicy-nut-salad-is-served-wherever-there-is.json": "Kanom Jeen Nam Ya (Rice Noodles with Chicken Curry Sauce)",
    "she-was-subsequently-enslaved-by-new-king-phetracha-who-made-her-work-in-his-kit.json": "Khanom Pui Fai (Thai Steamed Cupcakes)",
    # These 2 are flagged as unrecoverable but we can give descriptive names
    "in-either-case-it-s-something-of-a-staple-on-central-thai-tables-served-at-house.json": "Central Thai Condiment",

    # --- The Classic Italian Cook Book: recovered names ---
    "dough.json": "Baked Lasagne",
    "intheoven.json": "Baked Penne",
    "withclaims.json": "Spaghetti with Clams",
    "breadfriedinohve.json": "Panzanella (Tuscan Bread Salad)",
    "andleeks.json": "Jerusalem Artichokes and Leeks",
    "withrosemary.json": "Grilled Chicken with Rosemary",
    "parmesancheese.json": "Pasta with Parmesan Cheese",
    "toomitthehqueur.json": "Banana Frappee with Sliced Oranges",
    "ziti.json": "Ziti with Tomato-Butter Sauce",
    "artichokes.json": "Fried Artichokes",
    "tomatoes.json": "Tomato Sauce",
    "nutmeg.json": "Spinach with Nutmeg",
    "textures.json": "Italian Braised Dish",

    # --- Vegan Nigerian Kitchen: junk names -> recovered names ---
    "dairy.json": "Homemade Soy Milk",
    "fibre-packed.json": "Boiled Yam with Tofu Scramble",
    "these.json": "Vegan Isi Ewu / Nkwobi",
    "when.json": "Bean Paste Base for Akara",
    "ewa-is-the-yoruba-word-for-beans-and-this-popular-style-of-c.json": "Ewa Riro (Nigerian Stewed Beans)",

    # --- The Best of Fine Cooking: Breakfast ---
    "quick-start.json": "Quick-Start Baked Eggs",
    "brandied-apricot-almond-slab-pie-p-52.json": "Black Bean Breakfast Burritos",
    "this-beefed-up-version-of-the-mexican.json": "Steak and Eggs Huevos Rancheros",
    "a-strata-is-like-an-italian-quiche-but-instead-of.json": "Asparagus, Ham, and Mushroom Strata",
    "decadent-enough-to-be-dessert.json": "Chocolate-Stuffed French Toast",
    "drizzle-both-sides-with-the-maple-syrup.json": "Creamy Polenta with Mushroom Ragout",
    "one-bottle-of-sparkling-wine-is-enough-to-make.json": "Pomegranate Sparkling Wine Cocktail",
    "place-the-mushrooms-in-a-medium-heatproof.json": "Pulled Pork Hash with Avocado",
    "prop-a-poached-egg-and-a-few-slices.json": "Maple-Rum Glazed Pork Chops",
    "puff-pastry-s-light-and-airy-texture-combined.json": "Mushroom-Fontina Tart",
    "remove-the-rind-from-the-brie-while-the.json": "Oven-Toasted Ham, Brie, and Apple Sandwiches",
    "serve-slightly-warm-or-at-room-tempera.json": "Ham and Cheese Croissants",
    "sometimes-all-you-want-is-something-sweet.json": "Chocolate Tartines",
    "top-with-a-quarter-of-the-spinach-and-sprinkle-with-about.json": "Gruyere, Ham, and Tarragon Grilled Cheese",
    "wrap-cooled-brioches-well-and-store.json": "Cottage Cheese Breakfast Pastries",
    "yields-one-6x14-inch-jalousie-pastry.json": "Apple Jalousie Pastry",
    "you-can-make-this-refreshing-des.json": "Tropical Fruit Salad with Passionfruit",
}


def main():
    dry_run = "--dry-run" in sys.argv

    deleted_count = 0
    renamed_count = 0
    errors = []

    # Step 1: Delete duplicates
    print("=== Deleting duplicates ===")
    for filename in DUPLICATES_TO_DELETE:
        filepath = RECIPES_DIR / filename
        if filepath.exists():
            if dry_run:
                print(f"  [DRY RUN] Would delete: {filename}")
            else:
                filepath.unlink()
                print(f"  Deleted: {filename}")
            deleted_count += 1
        else:
            print(f"  SKIP (not found): {filename}")

    # Step 2: Fix names
    print("\n=== Fixing recipe names ===")
    for filename, new_name in NAME_FIXES.items():
        filepath = RECIPES_DIR / filename
        if filepath.exists():
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)

                old_name = data.get("name", "")
                if old_name == new_name:
                    print(f"  SKIP (already fixed): {filename}")
                    continue

                data["name"] = new_name

                if dry_run:
                    print(f"  [DRY RUN] Would rename: '{old_name}' -> '{new_name}'")
                else:
                    with open(filepath, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2, ensure_ascii=False)
                        f.write("\n")
                    print(f"  Renamed: '{old_name}' -> '{new_name}'")
                renamed_count += 1
            except Exception as e:
                errors.append(f"Error processing {filename}: {e}")
                print(f"  ERROR: {filename}: {e}")
        else:
            # File might have been deleted as a duplicate
            if filename in [f for f in DUPLICATES_TO_DELETE]:
                continue
            print(f"  SKIP (not found): {filename}")

    # Step 3: Check for remaining Thai Curry Cookbook 2 junk that might be
    # duplicates of legitimate recipes (same cookbook, similar name)
    print("\n=== Checking for additional Thai Curry duplicates ===")
    thai_curry_recipes = {}
    for filepath in RECIPES_DIR.glob("*.json"):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            cookbook = data.get("source", {}).get("cookbook", "")
            if cookbook == "The Complete and Authentic Thai Curry Cookbook 2":
                thai_curry_recipes[filepath.name] = data.get("name", "")
        except:
            pass

    # Find any remaining junk names in Thai Curry
    remaining_junk = []
    for fname, name in sorted(thai_curry_recipes.items()):
        # Check if the name looks like a sentence/fragment rather than a recipe title
        if (len(name) > 80 or
            name.endswith(".") or
            name.startswith("This ") or
            name.startswith("It ") or
            "you " in name.lower()):
            remaining_junk.append((fname, name))

    if remaining_junk:
        print(f"  Found {len(remaining_junk)} potentially remaining junk names:")
        for fname, name in remaining_junk:
            print(f"    {fname}: {name[:60]}...")

    # Summary
    print(f"\n=== Summary ===")
    print(f"  Duplicates deleted: {deleted_count}")
    print(f"  Names fixed: {renamed_count}")
    if errors:
        print(f"  Errors: {len(errors)}")
        for e in errors:
            print(f"    {e}")

    if dry_run:
        print("\n  (Dry run - no changes made)")


if __name__ == "__main__":
    main()
