"""Three starter articles, so the blog is not empty on day one.

Each in Dutch, English and Papiamentu (same slug = same article; see
blog/models.py). Written only from facts the website already states - the
warehouse address, the sailing times, how customs works - so the blog can
never contradict the rest of the site. The office can edit or delete them
from the dashboard like any other post.

The Papiamentu versions need a review by a native speaker.

Reversible, and the reverse only removes these three articles, never a post
the office wrote.
"""

from datetime import datetime, timezone

from django.db import migrations

ORDERING = "ordering-from-a-dutch-webshop"
FREIGHT = "sea-or-air-freight"
CUSTOMS = "vat-free-and-customs"

DATES = {
    CUSTOMS: datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc),
    FREIGHT: datetime(2026, 9, 15, 10, 0, tzinfo=timezone.utc),
    ORDERING: datetime(2026, 9, 29, 10, 0, tzinfo=timezone.utc),
}

POSTS = [
    # ------------------------------------------------------------ ordering
    (ORDERING, "nl", "Zo bestelt u bij een Nederlandse webshop",
     "Van uw account tot het pakket op het eiland: alle stappen op een rij, "
     "met het adres dat u bij het afrekenen invult.",
     """Bij vrijwel elke Nederlandse webshop kunt u via ons bestellen. U bestelt zelf, met uw eigen account bij die winkel. Wij zorgen dat het daarna op het eiland komt.

## 1. Maak een account aan
Met een account bij ons ziet u uw zendingen, facturen en Track & Trace op één plek. Aanmelden is gratis en duurt een minuut.

## 2. Bestel en betaal direct
Plaats uw bestelling bij de webshop van uw keuze en rond de betaling meteen af. Achteraf betalen is niet toegestaan.

## 3. Vul ons magazijnadres in
Gebruik bij het afrekenen dit adres, zowel bij de factuurgegevens als bij het afleveradres:
- Voornaam: uw eigen volledige voor- en achternaam
- Achternaam: Pay less Shop More
- Adres: Hertzstraat 10
- Postcode en plaats: 2652 XX Berkel en Rodenrijs

Is dit niet goed ingevuld, dan kunnen wij uw zending niet verwerken.

## 4. Meld uw zending bij ons aan
Laat ons met het aanmeldformulier (Boeking) of per e-mail weten dat er een pakket onderweg is, en stuur ons de factuur zo snel mogelijk.

## 5. Wij doen de rest
In ons magazijn boeken wij uw pakket in, meten en wegen het, en maken het klaar voor verzending. Losse pakketten kunnen wij samenvoegen tot één zending. Daarna volgt u alles met Track & Trace in uw account."""),
    (ORDERING, "en", "How to order from a Dutch webshop",
     "From your account to the parcel on the island: every step in order, "
     "with the address to fill in at checkout.",
     """You can order through us from almost any Dutch webshop. You order yourself, with your own account at that shop. We make sure it reaches the island.

## 1. Create an account
An account with us keeps your shipments, invoices and Track & Trace in one place. Signing up is free and takes a minute.

## 2. Order and pay straight away
Place your order with the webshop of your choice and complete the payment immediately. Paying afterwards is not allowed.

## 3. Fill in our warehouse address
At checkout, use this address for both the billing details and the delivery address:
- First name: your own full first and last name
- Last name: Pay less Shop More
- Address: Hertzstraat 10
- Postal code and city: 2652 XX Berkel en Rodenrijs

If this is not filled in correctly, we cannot process your shipment.

## 4. Register your shipment with us
Let us know through the booking form or by email that a parcel is on its way, and send us the invoice as soon as possible.

## 5. We do the rest
At our warehouse we book your parcel in, measure and weigh it, and make it ready to ship. Separate parcels can be combined into one shipment. You then follow everything with Track & Trace in your account."""),
    (ORDERING, "pap", "Kon pa ordená na un webshop hulandes",
     "For di bo kuenta te na e pakete riba e isla: tur e pasonan na órden, "
     "ku e adres pa yena ora bo ta paga.",
     """Bo por ordená via nos na kasi tur webshop hulandes. Bo ta ordená bo mes, ku bo mes kuenta na e tienda ei. Nos ta sigurá ku e ta yega riba e isla.

## 1. Traha un kuenta
Ku un kuenta serka nos bo ta mira bo enbionan, fakturanan i Track & Trace na un solo lugá. Registrá ta grátis i ta tuma un minüt.

## 2. Ordená i paga mesora
Pone bo order na e webshop ku bo ke i paga mesora. No ta permití pa paga despues.

## 3. Yena nos adres di warehouse
Ora bo ta paga, usa e adres aki pa e informashon di faktura i tambe pa e adres di entrega:
- Nòmber: bo mes nòmber i fam kompletu
- Fam: Pay less Shop More
- Adres: Hertzstraat 10
- Kódigo postal i stat: 2652 XX Berkel en Rodenrijs

Si esaki no ta yená korekto, nos no por prosesá bo enbio.

## 4. Anunsiá bo enbio serka nos
Laga nos sa via e formulario di boeking òf pa e-mail ku un pakete ta na kaminda, i manda nos e faktura mas lihé posibel.

## 5. Nos ta hasi e resto
Na nos warehouse nos ta registrá bo pakete, midi i pes'é, i prepar'é pa manda. Nos por kombiná varios pakete den un enbio. Despues bo ta sigui tur kos ku Track & Trace den bo kuenta."""),

    # ------------------------------------------------------------- freight
    (FREIGHT, "nl", "Zeevracht of luchtvracht: wat past bij u?",
     "Zeevracht is voordelig voor grote en zware zendingen, luchtvracht is "
     "sneller. Zo lang duurt het naar Aruba, Bonaire en Curaçao.",
     """Wij versturen uw zending per zeevracht of per luchtvracht. Welke het beste past, hangt af van wat u verstuurt en hoe snel u het nodig heeft.

## Zeevracht
Voor grote, zware of omvangrijke zendingen. De vaartijd is ongeveer:
- Aruba: 16 dagen
- Curaçao: 17 dagen
- Bonaire: 18 dagen

Daarna duurt de inklaring op het eiland circa anderhalve week.

## Luchtvracht
Heeft u het sneller nodig? Lever uw zending uiterlijk donderdag 12:00 aan, dan vliegt hij in het weekend. Voor Curaçao is er ook een vlucht op woensdag: lever dan uiterlijk maandag 12:00 aan. De inklaring duurt bij luchtvracht circa 3 tot 4 dagen.

## Wat kost het?
De prijs hangt af van het gewicht en het volume van uw zending, en van de verzendwijze. Onze offertes zijn altijd indicatief: het definitieve bedrag hangt af van wat wij bij ontvangst in ons magazijn meten en wegen. Vraag een offerte aan op de pagina van uw eiland.

Dit zijn schattingen; de werkelijke duur hangt af van het vaar- of vliegschema en de omstandigheden."""),
    (FREIGHT, "en", "Sea freight or air freight: which suits you?",
     "Sea freight is good value for large and heavy shipments, air freight is "
     "faster. This is how long it takes to Aruba, Bonaire and Curaçao.",
     """We send your shipment by sea freight or by air freight. Which one suits you best depends on what you are sending and how quickly you need it.

## Sea freight
For large, heavy or bulky shipments. The crossing takes about:
- Aruba: 16 days
- Curaçao: 17 days
- Bonaire: 18 days

Customs clearance on the island then takes about a week and a half.

## Air freight
Need it sooner? Hand in your shipment by Thursday 12:00 and it flies at the weekend. For Curaçao there is also a Wednesday flight: hand it in by Monday 12:00. Customs clearance for air freight takes about 3 to 4 days.

## What does it cost?
The price depends on the weight and volume of your shipment, and on how it is sent. Our quotes are always indicative: the final amount depends on what we measure and weigh when it reaches our warehouse. Request a quote on your island's page.

These are estimates; the actual time depends on the sailing or flight schedule and circumstances."""),
    (FREIGHT, "pap", "Fleta pa laman òf pa aire: kua ta bon pa bo?",
     "Fleta pa laman ta bon pa enbionan grandi i pisá, fleta pa aire ta mas "
     "lihé. Asina tantu tempu e ta tuma pa Aruba, Bonaire i Kòrsou.",
     """Nos ta manda bo enbio pa laman òf pa aire. Kua ta mihó pa bo ta dependé di kiko bo ta manda i kon lihé bo mester di dje.

## Fleta pa laman
Pa enbionan grandi, pisá òf ku ta okupá hopi lugá. E biahe ta tuma mas o ménos:
- Aruba: 16 dia
- Kòrsou: 17 dia
- Bonaire: 18 dia

Despues e trámite di aduana riba e isla ta tuma mas o ménos un siman i mei.

## Fleta pa aire
Bo mester di dje mas lihé? Entregá bo enbio lo mas tardá djaweps 12:00 i e ta bula den fin di siman. Pa Kòrsou tin tambe un buelo djárason: entreg'é lo mas tardá djaluna 12:00. E trámite di aduana pa fleta pa aire ta tuma mas o ménos 3 te 4 dia.

## Kuantu e ta kosta?
E preis ta dependé di e peso i e volumen di bo enbio, i di kon e ta wordu mandá. Nos preisnotanan ta semper indikativo: e suma final ta dependé di loke nos ta midi i pesa ora e yega nos warehouse. Pidi un preisnota riba e página di bo isla.

Esakinan ta estimashon; e tempu real ta dependé di e skedel di barku òf buelo i e sirkunstansianan."""),

    # ------------------------------------------------------------- customs
    (CUSTOMS, "nl", "Btw-vrij verzenden en de douane",
     "Waarom u zonder Nederlandse btw bestelt, en wat wij voor u regelen bij "
     "de douane op het eiland.",
     """Via ons verstuurt u uw aankopen btw-vrij naar Aruba, Bonaire of Curaçao. Zo hoeft u geen vrienden of familie in Nederland meer te vragen om iets voor u op te sturen.

## Wij regelen de papieren
U hoeft zelf niets met de douane te regelen. Wij maken de documenten in orde en handelen de douane af, zodat uw zending niet blijft liggen.

## Invoerrechten op het eiland
Invoerrechten op de bestemming staan los van onze verzendkosten. Uw offerte geeft er een indicatie van, zodat u vooraf weet waar u aan toe bent.

## Hoe lang duurt de inklaring?
- Zeevracht: circa anderhalve week na aankomst
- Luchtvracht: circa 3 tot 4 dagen

## Grote spullen
Ook spullen van groot formaat kunnen mee. Wij kijken per geval wat de beste manier van verschepen is. Vermeld de afmetingen in uw aanvraag.

Vragen? Neem contact met ons op, wij denken graag met u mee."""),
    (CUSTOMS, "en", "VAT-free shipping and customs",
     "Why you order without Dutch VAT, and what we arrange for you with "
     "customs on the island.",
     """Through us you send your purchases to Aruba, Bonaire or Curaçao free of Dutch VAT. That way you no longer need to ask friends or family in the Netherlands to send things on for you.

## We handle the paperwork
You do not need to arrange anything with customs yourself. We prepare the documents and handle customs, so your shipment does not sit waiting.

## Import duties on the island
Import duties at the destination are separate from our shipping costs. Your quote gives an indication of them, so you know where you stand in advance.

## How long does clearance take?
- Sea freight: about a week and a half after arrival
- Air freight: about 3 to 4 days

## Large items
Large items can come along too. We look case by case at the best way to ship them. Mention the dimensions in your request.

Questions? Get in touch, we are happy to think along with you."""),
    (CUSTOMS, "pap", "Manda sin BTW i e aduana",
     "Pakiko bo ta ordená sin BTW hulandes, i kiko nos ta regla pa bo ku e "
     "aduana riba e isla.",
     """Via nos bo ta manda bo kompranan sin BTW hulandes pa Aruba, Bonaire òf Kòrsou. Asina bo no mester pidi famia òf amigu na Hulanda mas pa manda kos pa bo.

## Nos ta regla e papelnan
Bo no mester regla nada ku e aduana bo mes. Nos ta prepará e dokumentonan i ta atendé ku e aduana, pa bo enbio no keda para.

## Derechi di importashon riba e isla
Derechi di importashon na e destinashon ta apart di nos kosto di enbio. Bo preisnota ta duna un indikashon di nan, pa bo sa di antemano kon e ta.

## Kuantu tempu e trámite ta tuma?
- Fleta pa laman: mas o ménos un siman i mei despues di yegada
- Fleta pa aire: mas o ménos 3 te 4 dia

## Kosnan grandi
Kosnan grandi tambe por bai. Nos ta wak pa kada kaso kua ta e mihó manera pa mand'é. Menshoná e midanan den bo petishon.

Pregunta? Tuma kontakto ku nos, nos ta yuda bo ku gusto."""),
]


def seed(apps, schema_editor):
    BlogPost = apps.get_model("blog", "BlogPost")
    for slug, language, title, summary, body in POSTS:
        # get_or_create: running this again must not raise on the unique
        # slug-and-language, nor overwrite a post the office has edited.
        BlogPost.objects.get_or_create(
            slug=slug,
            language=language,
            defaults={
                "title": title,
                "summary": summary,
                "body": body,
                "is_published": True,
                "published_at": DATES[slug],
            },
        )


def unseed(apps, schema_editor):
    BlogPost = apps.get_model("blog", "BlogPost")
    BlogPost.objects.filter(slug__in=[ORDERING, FREIGHT, CUSTOMS]).delete()


class Migration(migrations.Migration):
    dependencies = [("blog", "0001_initial")]

    operations = [migrations.RunPython(seed, unseed)]
