-- Locations: más ciudades de EE. UU., Puerto Rico (territorio, 78 municipios) y estados/ciudades
-- extranjeros presentes en el CRM. País → región/estado → comuna/ciudad. Idempotente.
-- Regiones/estados: Puerto Rico (territorio) y extranjeros presentes en el CRM
INSERT INTO public.locations (name, level, parent_id, is_private, is_active)
SELECT 'Puerto Rico','region',id,false,true FROM public.locations WHERE level='country' AND name='Estados Unidos'
ON CONFLICT DO NOTHING;

WITH f(country, region, city) AS (VALUES
('México','Aguascalientes','Aguascalientes'),('México','Estado de México','Ecatepec'),
('Colombia','Antioquia',NULL),('Colombia','Bolívar','Cartagena'),('Argentina','Buenos Aires','Azul'),
('Brasil','Paraná','Curitiba'),('Brasil','Rio de Janeiro','Niterói'),('España','Vizcaya','Barakaldo'),('España','Cataluña','Sabadell'),
('Francia','Auvergne-Rhône-Alpes','Bourg-en-Bresse'),('Francia','Centre-Val de Loire','Chanceaux-sur-Choisille'),
('Alemania','Berlin','Berlin'),('Alemania','Hessen','Eschborn'),('Alemania','Nordrhein-Westfalen','Troisdorf'),
('Reino Unido','England','Newquay'),('Portugal','Faro','São Brás de Alportel'),
('Suecia','Stockholm County','Tyresö'),('Suecia','Västra Götaland','Västra Frölunda'),
('Bélgica','Antwerp','Oud-Turnhout'),('Australia','Western Australia','Perth'))

INSERT INTO public.locations (name, level, parent_id, is_private, is_active)
SELECT DISTINCT f.region, 'region', c.id, false, true FROM f JOIN public.locations c ON c.level='country' AND c.name=f.country
ON CONFLICT DO NOTHING;

WITH us_cities(state, cities) AS (VALUES
('Alabama','Birmingham;Montgomery;Mobile;Huntsville;Tuscaloosa'),('Alaska','Anchorage;Fairbanks;Juneau'),
('Arizona','Phoenix;Tucson;Mesa;Chandler;Glendale;Tempe;Gilbert;Flagstaff'),('Arkansas','Rogers;Springdale;Conway;Jonesboro;Lowell'),
('California','Los Angeles;San Diego;San Jose;Sacramento;Oakland;Fresno;Long Beach;Anaheim;Santa Ana;Irvine;Riverside;Bakersfield;Stockton;Pasadena;Santa Monica;Palo Alto;Berkeley'),
('Colorado','Denver;Aurora;Boulder;Fort Collins;Lakewood'),('Connecticut','Hartford;New Haven;Stamford;Bridgeport'),('Delaware','Wilmington;Dover'),
('Florida','Jacksonville;Tampa;St. Petersburg;Tallahassee;Hialeah;Boca Raton;West Palm Beach;Naples;Coral Gables;Pensacola'),
('Georgia','Atlanta;Savannah;Augusta;Athens;Macon'),('Hawaii','Honolulu;Hilo'),('Idaho','Boise;Meridian;Idaho Falls'),
('Illinois','Aurora;Naperville;Rockford;Springfield;Peoria'),('Indiana','Indianapolis;Fort Wayne;Evansville;South Bend'),
('Iowa','Des Moines;Cedar Rapids;Davenport;Iowa City'),('Kansas','Wichita;Overland Park;Kansas City;Topeka'),
('Kentucky','Louisville;Lexington;Bowling Green'),('Louisiana','New Orleans;Lafayette;Lake Charles;West Monroe'),
('Maine','Portland;Bangor'),('Maryland','Baltimore;Annapolis;Rockville;Frederick'),('Massachusetts','Boston;Worcester;Cambridge;Springfield;Lowell'),
('Michigan','Detroit;Grand Rapids;Lansing;Flint'),('Minnesota','Minneapolis;Saint Paul;Rochester;Duluth'),('Mississippi','Jackson;Gulfport;Biloxi'),
('Missouri','Kansas City;St. Louis;Springfield;Columbia'),('Montana','Billings;Missoula;Bozeman'),('Nebraska','Omaha;Lincoln'),
('Nevada','Las Vegas;Reno;Henderson'),('New Hampshire','Manchester;Nashua;Concord'),('New Jersey','Newark;Jersey City;Trenton;Princeton;Hoboken'),
('New Mexico','Albuquerque;Santa Fe;Las Cruces'),('New York','Buffalo;Rochester;Albany;Syracuse;Yonkers;White Plains'),
('North Carolina','Charlotte;Raleigh;Greensboro;Durham;Asheville;Wilmington'),('North Dakota','Fargo;Bismarck'),
('Ohio','Columbus;Cleveland;Cincinnati;Toledo;Akron;Dayton'),('Oklahoma','Edmond;Lawton;Broken Arrow;Ardmore'),
('Oregon','Portland;Salem;Eugene;Bend'),('Pennsylvania','Philadelphia;Pittsburgh;Harrisburg;Allentown;Erie'),('Rhode Island','Providence;Newport'),
('South Carolina','Charleston;Columbia;Greenville;Myrtle Beach'),('South Dakota','Sioux Falls;Rapid City'),
('Tennessee','Nashville;Knoxville;Chattanooga;Clarksville'),
('Texas','El Paso;Laredo;Galveston;Abilene;Beaumont;Round Rock;San Marcos;Killeen;Odessa;Katy;Sugar Land;Conroe;Grapevine;Flower Mound;Mansfield;Keller'),
('Utah','Salt Lake City;Provo;Ogden;St. George;Orem'),('Vermont','Burlington;Montpelier'),
('Virginia','Virginia Beach;Richmond;Norfolk;Arlington;Alexandria'),('Washington','Bellevue;Everett;Vancouver;Olympia'),
('West Virginia','Charleston;Morgantown;Huntington'),('Wisconsin','Milwaukee;Madison;Green Bay'),('Wyoming','Cheyenne;Casper;Jackson'),
('Puerto Rico','Adjuntas;Aguada;Aguadilla;Aguas Buenas;Aibonito;Añasco;Arecibo;Arroyo;Barceloneta;Barranquitas;Bayamón;Cabo Rojo;Caguas;Camuy;Canóvanas;Carolina;Cataño;Cayey;Ceiba;Ciales;Cidra;Coamo;Comerío;Corozal;Culebra;Dorado;Fajardo;Florida;Guánica;Guayama;Guayanilla;Guaynabo;Gurabo;Hatillo;Hormigueros;Humacao;Isabela;Jayuya;Juana Díaz;Juncos;Lajas;Lares;Las Marías;Las Piedras;Loíza;Luquillo;Manatí;Maricao;Maunabo;Mayagüez;Moca;Morovis;Naguabo;Naranjito;Orocovis;Patillas;Peñuelas;Ponce;Quebradillas;Rincón;Río Grande;Sabana Grande;Salinas;San Germán;San Juan;San Lorenzo;San Sebastián;Santa Isabel;Toa Alta;Toa Baja;Trujillo Alto;Utuado;Vega Alta;Vega Baja;Vieques;Villalba;Yabucoa;Yauco')),
us AS (SELECT id FROM public.locations WHERE level='country' AND name='Estados Unidos' LIMIT 1)
INSERT INTO public.locations (name, level, parent_id, is_private, is_active)
SELECT DISTINCT trim(city), 'commune', r.id, false, true
FROM us_cities u CROSS JOIN LATERAL regexp_split_to_table(u.cities, ';') AS city
JOIN us ON true
JOIN public.locations r ON r.level='region' AND r.parent_id=us.id AND r.name=u.state
ON CONFLICT DO NOTHING;


-- Ciudades extranjeras
WITH f(country, region, city) AS (VALUES
('México','Aguascalientes','Aguascalientes'),('México','Estado de México','Ecatepec'),
('Colombia','Antioquia',NULL),('Colombia','Bolívar','Cartagena'),('Argentina','Buenos Aires','Azul'),
('Brasil','Paraná','Curitiba'),('Brasil','Rio de Janeiro','Niterói'),('España','Vizcaya','Barakaldo'),('España','Cataluña','Sabadell'),
('Francia','Auvergne-Rhône-Alpes','Bourg-en-Bresse'),('Francia','Centre-Val de Loire','Chanceaux-sur-Choisille'),
('Alemania','Berlin','Berlin'),('Alemania','Hessen','Eschborn'),('Alemania','Nordrhein-Westfalen','Troisdorf'),
('Reino Unido','England','Newquay'),('Portugal','Faro','São Brás de Alportel'),
('Suecia','Stockholm County','Tyresö'),('Suecia','Västra Götaland','Västra Frölunda'),
('Bélgica','Antwerp','Oud-Turnhout'),('Australia','Western Australia','Perth'))

INSERT INTO public.locations (name, level, parent_id, is_private, is_active)
SELECT f.city, 'commune', r.id, false, true
FROM f JOIN public.locations c ON c.level='country' AND c.name=f.country
JOIN public.locations r ON r.level='region' AND r.parent_id=c.id AND r.name=f.region
WHERE f.city IS NOT NULL
ON CONFLICT DO NOTHING;
