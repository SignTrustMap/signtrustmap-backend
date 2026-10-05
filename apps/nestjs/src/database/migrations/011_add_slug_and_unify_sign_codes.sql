-- =============================================================================
-- Add dedicated slug column and unify sign_code under standard QCVN 41 codes
-- =============================================================================

BEGIN;

-- 1. Add slug column if it does not exist
ALTER TABLE "traffic_sign_types" ADD COLUMN IF NOT EXISTS "slug" character varying(100);

-- 2. Populate slug from current sign_code if slug is NULL
UPDATE "traffic_sign_types" SET "slug" = UPPER("sign_code") WHERE "slug" IS NULL;

-- 3. Update sign_code to official QCVN standard codes, and ensure standardized name_vi / name_en
UPDATE "traffic_sign_types" SET "slug" = 'PEDESTRIAN_CROSSING', "sign_code" = 'W.224', "name_vi" = 'Đoạn đường người đi bộ cắt ngang', "name_en" = 'Pedestrian crossing', "updated_at" = now() WHERE "id" = 1;
UPDATE "traffic_sign_types" SET "slug" = 'ROAD_WORKS', "sign_code" = 'W.227', "name_vi" = 'Công trường đang thi công', "name_en" = 'Road works', "updated_at" = now() WHERE "id" = 2;
UPDATE "traffic_sign_types" SET "slug" = 'NO_ENTRY', "sign_code" = 'P.102', "name_vi" = 'Đường cấm / Cấm đi ngược chiều', "name_en" = 'No entry', "updated_at" = now() WHERE "id" = 3;
UPDATE "traffic_sign_types" SET "slug" = 'PEDESTRIAN_CROSSING_ZONE', "sign_code" = 'I.423a', "name_vi" = 'Vị trí người đi bộ sang đường', "name_en" = 'Pedestrian crossing zone', "updated_at" = now() WHERE "id" = 4;
UPDATE "traffic_sign_types" SET "slug" = 'STEEP_ASCENT_5_PERCENT', "sign_code" = 'W.220', "name_vi" = 'Dốc lên nguy hiểm 5%', "name_en" = 'Steep ascent 5 percent', "updated_at" = now() WHERE "id" = 5;
UPDATE "traffic_sign_types" SET "slug" = 'RAILWAY_CROSSING_WITH_GATES', "sign_code" = 'W.210', "name_vi" = 'Giao nhau với đường sắt có rào chắn', "name_en" = 'Railway crossing with gates', "updated_at" = now() WHERE "id" = 6;
UPDATE "traffic_sign_types" SET "slug" = 'ZONE.01', "sign_code" = 'ZONE.01', "name_vi" = 'Đoạn đường đang thi công', "name_en" = 'Roadwork zone', "updated_at" = now() WHERE "id" = 7;
UPDATE "traffic_sign_types" SET "slug" = 'TEST_SIGN_3', "sign_code" = 'TEST_SIGN_3', "name_vi" = 'Test Sign 3', "name_en" = 'Test Sign 3', "updated_at" = now() WHERE "id" = 8;
UPDATE "traffic_sign_types" SET "slug" = 'NO_CARS', "sign_code" = 'P.103a', "name_vi" = 'Cấm xe ô tô', "name_en" = 'No cars', "updated_at" = now() WHERE "id" = 23;
UPDATE "traffic_sign_types" SET "slug" = 'NO_CARS_TURN_RIGHT', "sign_code" = 'P.103b', "name_vi" = 'Cấm xe ô tô rẽ phải', "name_en" = 'No cars turn right', "updated_at" = now() WHERE "id" = 24;
UPDATE "traffic_sign_types" SET "slug" = 'NO_CARS_TURN_LEFT', "sign_code" = 'P.103c', "name_vi" = 'Cấm xe ô tô rẽ trái', "name_en" = 'No cars turn left', "updated_at" = now() WHERE "id" = 25;
UPDATE "traffic_sign_types" SET "slug" = 'NO_MOTORCYCLES', "sign_code" = 'P.104', "name_vi" = 'Cấm xe mô tô', "name_en" = 'No motorcycles', "updated_at" = now() WHERE "id" = 26;
UPDATE "traffic_sign_types" SET "slug" = 'NO_TRUCKS', "sign_code" = 'P.106a', "name_vi" = 'Cấm xe ô tô tải', "name_en" = 'No trucks', "updated_at" = now() WHERE "id" = 27;
UPDATE "traffic_sign_types" SET "slug" = 'NO_TRUCKS_OVER_2.5T', "sign_code" = 'P.106b', "name_vi" = 'Cấm xe ô tô tải trên 2.5 tấn', "name_en" = 'No trucks over 2.5T', "updated_at" = now() WHERE "id" = 28;
UPDATE "traffic_sign_types" SET "slug" = 'NO_PEDESTRIANS', "sign_code" = 'P.112', "name_vi" = 'Cấm người đi bộ', "name_en" = 'No pedestrians', "updated_at" = now() WHERE "id" = 29;
UPDATE "traffic_sign_types" SET "slug" = 'HEIGHT_LIMIT', "sign_code" = 'P.117', "name_vi" = 'Hạn chế chiều cao', "name_en" = 'Height limit', "updated_at" = now() WHERE "id" = 30;
UPDATE "traffic_sign_types" SET "slug" = 'NO_TURN_LEFT', "sign_code" = 'P.123a', "name_vi" = 'Cấm rẽ trái', "name_en" = 'No turn left', "updated_at" = now() WHERE "id" = 31;
UPDATE "traffic_sign_types" SET "slug" = 'NO_TURN_RIGHT', "sign_code" = 'P.123b', "name_vi" = 'Cấm rẽ phải', "name_en" = 'No turn right', "updated_at" = now() WHERE "id" = 32;
UPDATE "traffic_sign_types" SET "slug" = 'NO_U_TURN', "sign_code" = 'P.124a', "name_vi" = 'Cấm quay đầu xe', "name_en" = 'No U turn', "updated_at" = now() WHERE "id" = 33;
UPDATE "traffic_sign_types" SET "slug" = 'NO_TURN_LEFT_AND_U_TURN', "sign_code" = 'P.124c', "name_vi" = 'Cấm rẽ trái và quay đầu xe', "name_en" = 'No turn left and U turn', "updated_at" = now() WHERE "id" = 34;
UPDATE "traffic_sign_types" SET "slug" = 'SPEED_LIMIT_40', "sign_code" = 'P.127-40', "name_vi" = 'Tốc độ tối đa cho phép 40 km/h', "name_en" = 'Speed limit 40', "updated_at" = now() WHERE "id" = 35;
UPDATE "traffic_sign_types" SET "slug" = 'SPEED_LIMIT_50', "sign_code" = 'P.127-50', "name_vi" = 'Tốc độ tối đa cho phép 50 km/h', "name_en" = 'Speed limit 50', "updated_at" = now() WHERE "id" = 36;
UPDATE "traffic_sign_types" SET "slug" = 'SPEED_LIMIT_60', "sign_code" = 'P.127-60', "name_vi" = 'Tốc độ tối đa cho phép 60 km/h', "name_en" = 'Speed limit 60', "updated_at" = now() WHERE "id" = 37;
UPDATE "traffic_sign_types" SET "slug" = 'SPEED_LIMIT_70', "sign_code" = 'P.127-70', "name_vi" = 'Tốc độ tối đa cho phép 70 km/h', "name_en" = 'Speed limit 70', "updated_at" = now() WHERE "id" = 38;
UPDATE "traffic_sign_types" SET "slug" = 'SPEED_LIMIT_80', "sign_code" = 'P.127-80', "name_vi" = 'Tốc độ tối đa cho phép 80 km/h', "name_en" = 'Speed limit 80', "updated_at" = now() WHERE "id" = 39;
UPDATE "traffic_sign_types" SET "slug" = 'NO_HONKING', "sign_code" = 'P.128', "name_vi" = 'Cấm bấm còi', "name_en" = 'No honking', "updated_at" = now() WHERE "id" = 40;
UPDATE "traffic_sign_types" SET "slug" = 'NO_STOPPING_AND_PARKING', "sign_code" = 'P.130', "name_vi" = 'Cấm dừng xe và đỗ xe', "name_en" = 'No stopping and parking', "updated_at" = now() WHERE "id" = 41;
UPDATE "traffic_sign_types" SET "slug" = 'NO_PARKING', "sign_code" = 'P.131a', "name_vi" = 'Cấm đỗ xe', "name_en" = 'No parking', "updated_at" = now() WHERE "id" = 42;
UPDATE "traffic_sign_types" SET "slug" = 'NO_PARKING_ODD_DAYS', "sign_code" = 'P.131b', "name_vi" = 'Cấm đỗ xe ngày lẻ', "name_en" = 'No parking odd days', "updated_at" = now() WHERE "id" = 43;
UPDATE "traffic_sign_types" SET "slug" = 'NO_PARKING_EVEN_DAYS', "sign_code" = 'P.131c', "name_vi" = 'Cấm đỗ xe ngày chẵn', "name_en" = 'No parking even days', "updated_at" = now() WHERE "id" = 44;
UPDATE "traffic_sign_types" SET "slug" = 'NO_STRAIGHT_AHEAD', "sign_code" = 'P.137', "name_vi" = 'Cấm đi thẳng', "name_en" = 'No straight ahead', "updated_at" = now() WHERE "id" = 45;
UPDATE "traffic_sign_types" SET "slug" = 'NO_TURN_LEFT_AND_RIGHT', "sign_code" = 'P.138', "name_vi" = 'Cấm rẽ trái và rẽ phải', "name_en" = 'No turn left and right', "updated_at" = now() WHERE "id" = 46;
UPDATE "traffic_sign_types" SET "slug" = 'DANGEROUS_CURVE_LEFT', "sign_code" = 'W.201a', "name_vi" = 'Chỗ ngoặt nguy hiểm vòng bên trái', "name_en" = 'Dangerous curve left', "updated_at" = now() WHERE "id" = 47;
UPDATE "traffic_sign_types" SET "slug" = 'ROAD_NARROWS', "sign_code" = 'W.203a', "name_vi" = 'Đường bị hẹp cả hai bên', "name_en" = 'Road narrows', "updated_at" = now() WHERE "id" = 48;
UPDATE "traffic_sign_types" SET "slug" = 'CROSSROAD', "sign_code" = 'W.205a', "name_vi" = 'Giao nhau cùng mức các tuyến đường cùng cấp', "name_en" = 'Crossroad', "updated_at" = now() WHERE "id" = 49;
UPDATE "traffic_sign_types" SET "slug" = 'INTERSECTION_WITH_NON_PRIORITY_ROAD', "sign_code" = 'W.207a', "name_vi" = 'Giao nhau với đường không ưu tiên', "name_en" = 'Intersection with non priority road', "updated_at" = now() WHERE "id" = 50;
UPDATE "traffic_sign_types" SET "slug" = 'GIVE_WAY', "sign_code" = 'W.208', "name_vi" = 'Giao nhau với đường ưu tiên', "name_en" = 'Give way', "updated_at" = now() WHERE "id" = 51;
UPDATE "traffic_sign_types" SET "slug" = 'ROAD_BUMP', "sign_code" = 'W.221b', "name_vi" = 'Đường có gồ giảm tốc / mấp mô', "name_en" = 'Road bump', "updated_at" = now() WHERE "id" = 52;
UPDATE "traffic_sign_types" SET "slug" = 'CHILDREN_CROSSING', "sign_code" = 'W.225', "name_vi" = 'Đoạn đường hay có trẻ em ngang qua', "name_en" = 'Children crossing', "updated_at" = now() WHERE "id" = 53;
UPDATE "traffic_sign_types" SET "slug" = 'OVERHEAD_POWER_LINES', "sign_code" = 'W.239a', "name_vi" = 'Đường cáp điện ở phía trên', "name_en" = 'Overhead power lines', "updated_at" = now() WHERE "id" = 54;
UPDATE "traffic_sign_types" SET "slug" = 'CLEARANCE_HEIGHT', "sign_code" = 'W.239b', "name_vi" = 'Chiều cao tĩnh không thực tế', "name_en" = 'Clearance height', "updated_at" = now() WHERE "id" = 55;
UPDATE "traffic_sign_types" SET "slug" = 'SLOW_DOWN', "sign_code" = 'W.245a', "name_vi" = 'Đi chậm', "name_en" = 'Slow down', "updated_at" = now() WHERE "id" = 56;
UPDATE "traffic_sign_types" SET "slug" = 'GO_STRAIGHT', "sign_code" = 'R.301a', "name_vi" = 'Hướng đi thẳng phải theo', "name_en" = 'Go straight', "updated_at" = now() WHERE "id" = 57;
UPDATE "traffic_sign_types" SET "slug" = 'KEEP_RIGHT', "sign_code" = 'R.301b', "name_vi" = 'Hướng đi phải theo: Đi về phía bên phải', "name_en" = 'Keep right', "updated_at" = now() WHERE "id" = 58;
UPDATE "traffic_sign_types" SET "slug" = 'ROUNDABOUT', "sign_code" = 'R.303', "name_vi" = 'Nơi giao nhau chạy theo vòng xuyến', "name_en" = 'Roundabout', "updated_at" = now() WHERE "id" = 59;
UPDATE "traffic_sign_types" SET "slug" = 'MAIN_ROAD', "sign_code" = 'I.401', "name_vi" = 'Bắt đầu đường ưu tiên', "name_en" = 'Main road', "updated_at" = now() WHERE "id" = 60;
UPDATE "traffic_sign_types" SET "slug" = 'END_MAIN_ROAD', "sign_code" = 'I.402', "name_vi" = 'Hết đoạn đường ưu tiên', "name_en" = 'End main road', "updated_at" = now() WHERE "id" = 61;
UPDATE "traffic_sign_types" SET "slug" = 'HOSPITAL', "sign_code" = 'I.428', "name_vi" = 'Bệnh viện', "name_en" = 'Hospital', "updated_at" = now() WHERE "id" = 62;
UPDATE "traffic_sign_types" SET "slug" = 'BUS_STOP', "sign_code" = 'I.434a', "name_vi" = 'Trạm dừng xe buýt', "name_en" = 'Bus stop', "updated_at" = now() WHERE "id" = 63;
UPDATE "traffic_sign_types" SET "slug" = 'MARKET', "sign_code" = 'W.234', "name_vi" = 'Đoạn đường hay họp chợ', "name_en" = 'Market', "updated_at" = now() WHERE "id" = 64;
UPDATE "traffic_sign_types" SET "slug" = 'OTHER_PROHIBITION_SIGNS', "sign_code" = 'P.140', "name_vi" = 'Biển báo cấm khác / Cấm chung', "name_en" = 'Other prohibition signs', "updated_at" = now() WHERE "id" = 65;
UPDATE "traffic_sign_types" SET "slug" = 'NO_SLOW_MOVING_VEHICLES', "sign_code" = 'P.113', "name_vi" = 'Cấm xe súc vật kéo / xe thô sơ', "name_en" = 'No slow moving vehicles', "updated_at" = now() WHERE "id" = 66;
UPDATE "traffic_sign_types" SET "slug" = 'U_TURN_AREA', "sign_code" = 'I.409', "name_vi" = 'Khu vực quay đầu xe', "name_en" = 'U turn area', "updated_at" = now() WHERE "id" = 67;
UPDATE "traffic_sign_types" SET "slug" = 'PEDESTRIAN_OVERPASS', "sign_code" = 'I.424a', "name_vi" = 'Cầu vượt qua đường cho người đi bộ', "name_en" = 'Pedestrian overpass', "updated_at" = now() WHERE "id" = 68;
UPDATE "traffic_sign_types" SET "slug" = 'WIDTH_LIMIT', "sign_code" = 'P.118', "name_vi" = 'Hạn chế chiều ngang xe', "name_en" = 'Width limit', "updated_at" = now() WHERE "id" = 69;
UPDATE "traffic_sign_types" SET "slug" = 'WEIGHT_LIMIT', "sign_code" = 'P.115', "name_vi" = 'Hạn chế trọng lượng xe', "name_en" = 'Weight limit', "updated_at" = now() WHERE "id" = 70;
UPDATE "traffic_sign_types" SET "slug" = 'NO_TRAILERS', "sign_code" = 'P.108', "name_vi" = 'Cấm xe kéo rơ-moóc', "name_en" = 'No trailers', "updated_at" = now() WHERE "id" = 71;
UPDATE "traffic_sign_types" SET "slug" = 'NO_VEHICLES_CARRYING_DANGEROUS_GOODS', "sign_code" = 'P.109', "name_vi" = 'Cấm xe chở hàng nguy hiểm', "name_en" = 'No vehicles carrying dangerous goods', "updated_at" = now() WHERE "id" = 72;
UPDATE "traffic_sign_types" SET "slug" = 'TUNNEL', "sign_code" = 'W.240', "name_vi" = 'Đường hầm', "name_en" = 'Tunnel', "updated_at" = now() WHERE "id" = 73;
UPDATE "traffic_sign_types" SET "slug" = 'NO_BICYCLES', "sign_code" = 'P.110a', "name_vi" = 'Cấm người đi xe đạp', "name_en" = 'No bicycles', "updated_at" = now() WHERE "id" = 74;
UPDATE "traffic_sign_types" SET "slug" = 'CLIFF_AHEAD', "sign_code" = 'W.216a', "name_vi" = 'Vách núi / Kè vực sâu nguy hiểm', "name_en" = 'Cliff ahead', "updated_at" = now() WHERE "id" = 75;
UPDATE "traffic_sign_types" SET "slug" = 'MIN_SPEED_LIMIT_30', "sign_code" = 'R.306-30', "name_vi" = 'Tốc độ tối thiểu cho phép 30 km/h', "name_en" = 'Min speed limit 30', "updated_at" = now() WHERE "id" = 76;
UPDATE "traffic_sign_types" SET "slug" = 'MIN_DISTANCE_BETWEEN_VEHICLES', "sign_code" = 'P.121', "name_vi" = 'Cự ly tối thiểu giữa hai xe', "name_en" = 'Min distance between vehicles', "updated_at" = now() WHERE "id" = 77;
UPDATE "traffic_sign_types" SET "slug" = 'NO_OVERTAKING', "sign_code" = 'P.125', "name_vi" = 'Cấm vượt', "name_en" = 'No overtaking', "updated_at" = now() WHERE "id" = 78;
UPDATE "traffic_sign_types" SET "slug" = 'END_MIN_SPEED_LIMIT_30', "sign_code" = 'R.307', "name_vi" = 'Hết tốc độ tối thiểu cho phép 30 km/h', "name_en" = 'End min speed limit 30', "updated_at" = now() WHERE "id" = 79;
UPDATE "traffic_sign_types" SET "slug" = 'NO_MOTORCYCLES_AND_SLOW_VEHICLES', "sign_code" = 'P.105', "name_vi" = 'Cấm xe mô tô và xe thô sơ', "name_en" = 'No motorcycles and slow vehicles', "updated_at" = now() WHERE "id" = 80;
UPDATE "traffic_sign_types" SET "slug" = 'END_DUAL_CARRIAGEWAY', "sign_code" = 'W.235', "name_vi" = 'Hết đường đôi', "name_en" = 'End dual carriageway', "updated_at" = now() WHERE "id" = 81;
UPDATE "traffic_sign_types" SET "slug" = 'NO_BUSES_AND_TRUCKS', "sign_code" = 'P.107', "name_vi" = 'Cấm xe buýt và xe ô tô tải', "name_en" = 'No buses and trucks', "updated_at" = now() WHERE "id" = 82;
UPDATE "traffic_sign_types" SET "slug" = 'TWO_WAY_TRAFFIC', "sign_code" = 'W.204', "name_vi" = 'Đường hai chiều', "name_en" = 'Two way traffic', "updated_at" = now() WHERE "id" = 83;
UPDATE "traffic_sign_types" SET "slug" = 'ACCIDENT_AREA', "sign_code" = 'W.244', "name_vi" = 'Đoạn đường hay xảy ra tai nạn', "name_en" = 'Accident area', "updated_at" = now() WHERE "id" = 84;
UPDATE "traffic_sign_types" SET "slug" = 'TURN_LEFT_ONLY', "sign_code" = 'R.301e', "name_vi" = 'Hướng đi phải theo: Rẽ trái', "name_en" = 'Turn left only', "updated_at" = now() WHERE "id" = 85;
UPDATE "traffic_sign_types" SET "slug" = 'TURN_RIGHT_ONLY', "sign_code" = 'R.301d', "name_vi" = 'Hướng đi phải theo: Rẽ phải', "name_en" = 'Turn right only', "updated_at" = now() WHERE "id" = 86;
UPDATE "traffic_sign_types" SET "slug" = 'ONE_WAY_ROAD', "sign_code" = 'I.407a', "name_vi" = 'Đường một chiều', "name_en" = 'One way road', "updated_at" = now() WHERE "id" = 87;
UPDATE "traffic_sign_types" SET "slug" = 'UNDERPASS', "sign_code" = 'I.424b', "name_vi" = 'Hầm chui cho người đi bộ', "name_en" = 'Underpass', "updated_at" = now() WHERE "id" = 88;
UPDATE "traffic_sign_types" SET "slug" = 'RESIDENTIAL_AREA', "sign_code" = 'R.420', "name_vi" = 'Bắt đầu khu đông dân cư', "name_en" = 'Residential area', "updated_at" = now() WHERE "id" = 89;
UPDATE "traffic_sign_types" SET "slug" = 'END_RESIDENTIAL_AREA', "sign_code" = 'R.421', "name_vi" = 'Hết khu đông dân cư', "name_en" = 'End residential area', "updated_at" = now() WHERE "id" = 90;
UPDATE "traffic_sign_types" SET "slug" = 'NO_CARS_U_TURN', "sign_code" = 'P.124b', "name_vi" = 'Cấm xe ô tô quay đầu xe', "name_en" = 'No cars U turn', "updated_at" = now() WHERE "id" = 91;
UPDATE "traffic_sign_types" SET "slug" = 'DANGEROUS_CURVE_RIGHT', "sign_code" = 'W.201b', "name_vi" = 'Chỗ ngoặt nguy hiểm vòng bên phải', "name_en" = 'Dangerous curve right', "updated_at" = now() WHERE "id" = 92;
UPDATE "traffic_sign_types" SET "slug" = 'MULTIPLE_CURVES', "sign_code" = 'W.202', "name_vi" = 'Chỗ ngoặt nguy hiểm liên tiếp', "name_en" = 'Multiple curves', "updated_at" = now() WHERE "id" = 93;
UPDATE "traffic_sign_types" SET "slug" = 'ROAD_NARROWS_LEFT', "sign_code" = 'W.203b', "name_vi" = 'Đường bị hẹp về phía trái', "name_en" = 'Road narrows left', "updated_at" = now() WHERE "id" = 94;
UPDATE "traffic_sign_types" SET "slug" = 'ROAD_NARROWS_RIGHT', "sign_code" = 'W.203c', "name_vi" = 'Đường bị hẹp về phía phải', "name_en" = 'Road narrows right', "updated_at" = now() WHERE "id" = 95;
UPDATE "traffic_sign_types" SET "slug" = 'INTERSECTION_WITH_NON_PRIORITY_ROAD_RIGHT', "sign_code" = 'W.207b', "name_vi" = 'Giao nhau với đường không ưu tiên bên phải', "name_en" = 'Intersection with non priority road right', "updated_at" = now() WHERE "id" = 96;
UPDATE "traffic_sign_types" SET "slug" = 'T_JUNCTION', "sign_code" = 'W.205b', "name_vi" = 'Giao nhau ngã ba chữ T', "name_en" = 'T junction', "updated_at" = now() WHERE "id" = 97;
UPDATE "traffic_sign_types" SET "slug" = 'T_JUNCTION_RIGHT', "sign_code" = 'W.205c', "name_vi" = 'Giao nhau nhánh rẽ phải', "name_en" = 'T junction right', "updated_at" = now() WHERE "id" = 98;
UPDATE "traffic_sign_types" SET "slug" = 'T_JUNCTION_LEFT', "sign_code" = 'W.205d', "name_vi" = 'Giao nhau nhánh rẽ trái', "name_en" = 'T junction left', "updated_at" = now() WHERE "id" = 99;
UPDATE "traffic_sign_types" SET "slug" = 'INTERSECTION_WITH_NON_PRIORITY_ROAD_LEFT', "sign_code" = 'W.207c', "name_vi" = 'Giao nhau với đường không ưu tiên bên trái', "name_en" = 'Intersection with non priority road left', "updated_at" = now() WHERE "id" = 100;
UPDATE "traffic_sign_types" SET "slug" = 'END_NO_OVERTAKING', "sign_code" = 'DP.133', "name_vi" = 'Hết cấm vượt', "name_en" = 'End no overtaking', "updated_at" = now() WHERE "id" = 101;
UPDATE "traffic_sign_types" SET "slug" = 'END_ALL_PROHIBITIONS', "sign_code" = 'DP.135', "name_vi" = 'Hết tất cả các lệnh cấm', "name_en" = 'End all prohibitions', "updated_at" = now() WHERE "id" = 102;
UPDATE "traffic_sign_types" SET "slug" = 'END_TUNNEL', "sign_code" = 'I.441a', "name_vi" = 'Hết đường hầm', "name_en" = 'End tunnel', "updated_at" = now() WHERE "id" = 103;
UPDATE "traffic_sign_types" SET "slug" = 'SPEED_LIMIT_90', "sign_code" = 'P.127-90', "name_vi" = 'Tốc độ tối đa cho phép 90 km/h', "name_en" = 'Speed limit 90', "updated_at" = now() WHERE "id" = 104;
UPDATE "traffic_sign_types" SET "slug" = 'SPEED_LIMIT_100', "sign_code" = 'P.127-100', "name_vi" = 'Tốc độ tối đa cho phép 100 km/h', "name_en" = 'Speed limit 100', "updated_at" = now() WHERE "id" = 105;
UPDATE "traffic_sign_types" SET "slug" = 'ROAD_RESERVED_FOR_CARS', "sign_code" = 'R.403a', "name_vi" = 'Đường dành cho xe ô tô', "name_en" = 'Road reserved for cars', "updated_at" = now() WHERE "id" = 106;
UPDATE "traffic_sign_types" SET "slug" = 'EXPRESSWAY', "sign_code" = 'I.437', "name_vi" = 'Đường cao tốc', "name_en" = 'Expressway', "updated_at" = now() WHERE "id" = 107;
UPDATE "traffic_sign_types" SET "slug" = 'AXLE_WEIGHT_LIMIT', "sign_code" = 'P.116', "name_vi" = 'Hạn chế tải trọng trên trục xe', "name_en" = 'Axle weight limit', "updated_at" = now() WHERE "id" = 108;
UPDATE "traffic_sign_types" SET "slug" = 'ROAD_CLOSED', "sign_code" = 'P.101', "name_vi" = 'Đường cấm tất cả các loại phương tiện', "name_en" = 'Road closed', "updated_at" = now() WHERE "id" = 109;
UPDATE "traffic_sign_types" SET "slug" = 'DEAD_END', "sign_code" = 'I.405a', "name_vi" = 'Đường cụt', "name_en" = 'Dead end', "updated_at" = now() WHERE "id" = 110;
UPDATE "traffic_sign_types" SET "slug" = 'RESERVED_FOR_DISABLED', "sign_code" = 'I.444', "name_vi" = 'Vị trí dành riêng cho người khuyết tật', "name_en" = 'Reserved for disabled', "updated_at" = now() WHERE "id" = 111;
UPDATE "traffic_sign_types" SET "slug" = 'CHECKPOINT', "sign_code" = 'P.129', "name_vi" = 'Trạm kiểm soát', "name_en" = 'Checkpoint', "updated_at" = now() WHERE "id" = 112;
UPDATE "traffic_sign_types" SET "slug" = 'SPEED_LIMIT_120', "sign_code" = 'P.127-120', "name_vi" = 'Tốc độ tối đa cho phép 120 km/h', "name_en" = 'Speed limit 120', "updated_at" = now() WHERE "id" = 113;
UPDATE "traffic_sign_types" SET "slug" = 'PARKING_AREA', "sign_code" = 'I.408', "name_vi" = 'Nơi đỗ xe', "name_en" = 'Parking area', "updated_at" = now() WHERE "id" = 114;
UPDATE "traffic_sign_types" SET "slug" = 'MIN_SPEED_LIMIT_60', "sign_code" = 'R.306-60', "name_vi" = 'Tốc độ tối thiểu cho phép 60 km/h', "name_en" = 'Min speed limit 60', "updated_at" = now() WHERE "id" = 115;
UPDATE "traffic_sign_types" SET "slug" = 'STEEP_DESCENT_5_PERCENT', "sign_code" = 'W.219', "name_vi" = 'Dốc xuống nguy hiểm 5%', "name_en" = 'Steep descent 5 percent', "updated_at" = now() WHERE "id" = 116;

-- 4. Create unique index on slug for fast lookup and integrity
CREATE UNIQUE INDEX IF NOT EXISTS "traffic_sign_types_slug_idx" ON "traffic_sign_types" ("slug");

COMMIT;
