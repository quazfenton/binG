/**
 * Public re-exports for the VFS module.
 *
 * @see ./transactional-vfs for the OCC + transaction primitives.
 */
export {
  beginTransaction,
  readWithVersion,
  writeWithVersion,
  VersionMismatchError,
  ConcurrentModificationError,
  Transaction,
  type VersionedFile,
  type WriteWithVersionOptions,
  type TransactionalEdit,
  type TransactionResult,
} from './transactional-vfs';
