# C0时间与Proto设计基线

版本：0.0.0｜状态：设计基线，科学时间待实证｜日期：2026-10-27

## 时间设计
TimeInstant使用time_scale、epoch_id、seconds(int64)、nanos(uint32)，要求0<=nanos<1000000000。时间尺度与历元必须显式指定，未知值拒绝。TT、TDB、UTC不能静默混用。NASA DYN的J2000零点和时间尺度须与真实样本及独立星历比对后再冻结。

## 单位
科学位置m、速度m/s、角度rad、角速度rad/s。所有空间状态携带FrameId、requested_instant、有效区间和来源。参考系旋转时的速度转换必须处理导数。

## 身份
ObjectId、FrameId、ResourceId是独立命名空间的稳定公开标识。内部slot+generation句柄不进入持久化Proto。SessionId、RequestId和TaskId分别定义语义，不得互换。

## Proto消息边界
CommandEnvelope、QueryEnvelope、EventEnvelope、ResponseEnvelope、FrameSnapshot、TimeInstant、SceneCommand、TaskResult、ResourceRef为候选核心消息。使用oneof承载已知命令，不以任意opaque bytes绕过能力验证。公开消息由一个权威Schema生成Rust和TypeScript类型。

## 待完成
字段编号、完整.proto编译、Rust/TS往返、TT/TDB与NASA DYN科学时间核验、错误码枚举及兼容性检查均需实证。此文档不是已冻结Schema。