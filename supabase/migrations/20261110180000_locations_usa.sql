-- Estados Unidos en Locations (única fuente de geografía), misma estructura que Chile:
-- país (level 'country') → estado (level 'region') → ciudad (level 'commune').
-- Idempotente: el índice único locations_geo_unique_name evita duplicados.
WITH us AS (SELECT id FROM public.locations WHERE level = 'country' AND name = 'Estados Unidos' LIMIT 1)
INSERT INTO public.locations (name, level, parent_id, is_private, is_active)
SELECT s.name, 'region', us.id, false, true
FROM us, unnest(ARRAY['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming']) AS s(name)
ON CONFLICT DO NOTHING;

-- Ciudades identificadas con certeza en los contactos del CRM (estado, ciudad).
WITH c(state, city) AS (VALUES
('Arizona','Scottsdale'),('Arkansas','Bentonville'),('Arkansas','Fairfield Bay'),('Arkansas','Fayetteville'),('Arkansas','Fort Smith'),('Arkansas','Hot Springs'),('Arkansas','Little Rock'),('Arkansas','Magnolia'),
('California','Huntington Beach'),('California','Mountain View'),('California','Murrieta'),('California','North Hills'),('California','Northridge'),('California','Orange'),('California','San Francisco'),('California','Santa Rosa'),('California','Visalia'),('California','Westlake Village'),
('Colorado','Colorado Springs'),('Colorado','Dolores'),('Colorado','Grand Junction'),('Connecticut','Norwalk'),('Delaware','Newark'),
('Florida','Davie'),('Florida','Destin'),('Florida','Doral'),('Florida','Edgewater'),('Florida','Fort Lauderdale'),('Florida','Hollywood'),('Florida','Miami'),('Florida','Niceville'),('Florida','Orlando'),
('Illinois','Chicago'),('Illinois','Highland Park'),('Indiana','Bloomington'),('Indiana','Lafayette'),('Kentucky','Cromwell'),('Louisiana','Baton Rouge'),('Louisiana','Keithville'),('Louisiana','Shreveport'),
('Maine','Calais'),('Michigan','Ann Arbor'),('Minnesota','Red Wing'),('Mississippi','Pontotoc'),('Missouri','Bolivar'),('New York','Coram'),('New York','Eden'),('New York','New York'),('North Carolina','Clayton'),
('Oklahoma','Kingston'),('Oklahoma','Muskogee'),('Oklahoma','Norman'),('Oklahoma','Oklahoma City'),('Oklahoma','Skiatook'),('Oklahoma','Tulsa'),
('South Carolina','Camden'),('South Carolina','Hilton Head Island'),('Tennessee','Cordova'),('Tennessee','Memphis'),
('Texas','Addison'),('Texas','Aledo'),('Texas','Allen'),('Texas','Amarillo'),('Texas','Arlington'),('Texas','Athens'),('Texas','Austin'),('Texas','Bedford'),('Texas','Belton'),('Texas','Benbrook'),('Texas','Bridgeport'),('Texas','Brownsville'),('Texas','Bryan'),('Texas','Burleson'),('Texas','Canyon Lake'),('Texas','Carrollton'),('Texas','Cedar Hill'),('Texas','Cleburne'),('Texas','Clint'),('Texas','Colleyville'),('Texas','Coppell'),('Texas','Corpus Christi'),('Texas','Corsicana'),('Texas','Crowley'),('Texas','Dallas'),('Texas','De Soto'),('Texas','Denton'),('Texas','Double Oak'),('Texas','Dripping Springs'),('Texas','Duncanville'),('Texas','Ennis'),('Texas','Euless'),('Texas','Fairview'),('Texas','Farmers Branch'),('Texas','Forney'),('Texas','Fort Worth'),('Texas','Frisco'),('Texas','Garland'),('Texas','Grand Prairie'),('Texas','Greenville'),('Texas','Haltom City'),('Texas','Haslet'),('Texas','Heath'),('Texas','Houston'),('Texas','Humble'),('Texas','Huntsville'),('Texas','Irving'),('Texas','Justin'),('Texas','Lancaster'),('Texas','Lewisville'),('Texas','Little Elm'),('Texas','Longview'),('Texas','Lubbock'),('Texas','Lucas'),('Texas','Magnolia'),('Texas','McAllen'),('Texas','McKinney'),('Texas','Mesquite'),('Texas','Midland'),('Texas','Midlothian'),('Texas','Mineola'),('Texas','New Braunfels'),('Texas','North Richland Hills'),('Texas','Ovilla'),('Texas','Pampa'),('Texas','Pflugerville'),('Texas','Pittsburg'),('Texas','Plano'),('Texas','Powderly'),('Texas','Prosper'),('Texas','Providence Village'),('Texas','Richardson'),('Texas','Rockwall'),('Texas','Rowlett'),('Texas','Royse City'),('Texas','San Antonio'),('Texas','Seabrook'),('Texas','Sherman'),('Texas','Southlake'),('Texas','Teague'),('Texas','Terrell'),('Texas','The Colony'),('Texas','The Woodlands'),('Texas','Tyler'),('Texas','Waco'),('Texas','Waxahachie'),('Texas','Wichita Falls'),('Texas','Wylie'),
('Utah','Smithfield'),('Washington','Seattle'),('Washington','Spokane'),('Washington','Tacoma'))
INSERT INTO public.locations (name, level, parent_id, is_private, is_active)
SELECT c.city, 'commune', r.id, false, true
FROM c
JOIN public.locations us ON us.level = 'country' AND us.name = 'Estados Unidos'
JOIN public.locations r ON r.level = 'region' AND r.parent_id = us.id AND r.name = c.state
ON CONFLICT DO NOTHING;
